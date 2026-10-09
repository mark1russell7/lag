import { describe, expect, it, vi } from "vitest";
import { RateLimiter, stripUrlParameters } from "./rate-limiter.js";
import { encodeOtlpLogs, millisToUnixNanoString } from "./otlp-json.js";
import { createOtelEventSink } from "./otel-logger-adapter.js";
import { createNoopEventSink } from "./events.js";

describe("RateLimiter", () => {
    it("permits `limit` actions in each window", () => {
        let now = 0;
        const limiter = new RateLimiter({ now : () => now }, 2, 1_000);

        expect([limiter.tryAcquire(), limiter.tryAcquire(), limiter.tryAcquire()]).toEqual([true, true, false]);
        now = 999;
        expect(limiter.tryAcquire()).toBe(false);
        now = 1_000;
        expect(limiter.tryAcquire()).toBe(true);
    });
});

describe("stripUrlParameters", () => {
    it("removes the query string and the fragment", () => {
        expect(stripUrlParameters("https://a.example/app.js?token=secret#x")).toBe("https://a.example/app.js");
        expect(stripUrlParameters("https://a.example/p#frag")).toBe("https://a.example/p");
        expect(stripUrlParameters("https://a.example/p")).toBe("https://a.example/p");
        expect(stripUrlParameters("?token=secret")).toBe("");
        expect(stripUrlParameters("")).toBe("");
    });
});

describe("OTLP JSON encoding", () => {
    it("converts milliseconds to a nanosecond string, rounded to microseconds", () => {
        expect(millisToUnixNanoString(1_700_000_000_123.456)).toBe("1700000000123456000");
        expect(millisToUnixNanoString(0)).toBe("0");
    });

    it("encodes log records as an ExportLogsServiceRequest", () => {
        const body = JSON.parse(encodeOtlpLogs({ "service.name" : "shop" }, "@lag/worker", [{
            timeMs : 1_000,
            eventName : "lag.main_thread.hang",
            severityText : "WARN",
            severityNumber : 13,
            body : "Main thread hang started",
            attributes : { phase : "started", duration_ms : 5_000, ratio : 0.5, final : false },
        }]));

        const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];
        expect(body.resourceLogs[0].resource.attributes).toEqual([{ key : "service.name", value : { stringValue : "shop" } }]);
        expect(body.resourceLogs[0].scopeLogs[0].scope).toEqual({ name : "@lag/worker" });
        expect(record).toEqual({
            timeUnixNano : "1000000000",
            observedTimeUnixNano : "1000000000",
            eventName : "lag.main_thread.hang",
            severityNumber : 13,
            severityText : "WARN",
            body : { stringValue : "Main thread hang started" },
            attributes : [
                { key : "phase", value : { stringValue : "started" } },
                { key : "duration_ms", value : { intValue : "5000" } },
                { key : "ratio", value : { doubleValue : 0.5 } },
                { key : "final", value : { boolValue : false } },
            ],
        });
    });

    it("gives a record the observed time of the input, or the time of the occurrence", () => {
        const body = JSON.parse(encodeOtlpLogs({}, "@lag/worker", [
            { timeMs : 1_000, observedTimeMs : 9_000, eventName : "a", severityText : "INFO", severityNumber : 9, body : "a", attributes : {} },
        ]));
        const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];
        expect([record.timeUnixNano, record.observedTimeUnixNano]).toEqual(["1000000000", "9000000000"]);
    });
});

describe("event sinks", () => {
    it("the OTel event sink emits a log record with the event name, without empty attributes", () => {
        const otelLogger = { emit : vi.fn() };
        createOtelEventSink(otelLogger).emit("browser.web_vital", {
            value : 240,
            name : "INP",
            missing : undefined as unknown as string,
        });

        expect(otelLogger.emit).toHaveBeenCalledWith({
            eventName : "browser.web_vital",
            severityText : "INFO",
            severityNumber : 9,
            body : "browser.web_vital name=INP value=240",
            attributes : { name : "INP", value : 240 },
        });
    });

    it("gives each event a different body, so that Loki keeps events of the same millisecond", () => {
        const otelLogger = { emit : vi.fn() };
        const sink = createOtelEventSink(otelLogger);
        for (const name of ["lcp", "fcp", "ttfb"]) sink.emit("browser.web_vital", { "browser.web_vital.name" : name });
        sink.emit("lag.stall", { kind : "hang", target : "#a b", empty : "", note : 'say "hi"', ok : true });

        const bodies = otelLogger.emit.mock.calls.map(([record]) => (record as { body : string }).body);
        expect(new Set(bodies).size).toBe(4);
        expect(bodies[3]).toBe('lag.stall empty="" kind=hang note="say \\"hi\\"" ok=true target="#a b"');
    });

    it("the OTel event sink gives the time of the occurrence to the record", () => {
        const otelLogger = { emit : vi.fn() };
        createOtelEventSink(otelLogger, { now : () => 1_000_000 }).emit("lag.stall", { kind : "hang" }, { time : 990_000 });

        expect(otelLogger.emit).toHaveBeenCalledWith(expect.objectContaining({ timestamp : 990_000, attributes : { kind : "hang" } }));
    });

    it("the OTel event sink keeps the time of the call for an occurrence that is too old for Loki, and keeps its time as an attribute", () => {
        const otelLogger = { emit : vi.fn() };
        const sink = createOtelEventSink(otelLogger, { now : () => 1_000_000, maxTimeOffsetMs : 5_000 });
        sink.emit("browser.web_vital", { "browser.web_vital.name" : "lcp" }, { time : 994_000 });
        sink.emit("lag.stall", { kind : "hang" });

        const [old, untimed] = otelLogger.emit.mock.calls.map(([record]) => record as Record<string, unknown>);
        expect(old).not.toHaveProperty("timestamp");
        expect(old!["attributes"]).toEqual({ "browser.web_vital.name" : "lcp", "lag.event.time" : 994_000 });
        expect(old!["body"]).toBe("browser.web_vital browser.web_vital.name=lcp lag.event.time=994000");
        expect(untimed).not.toHaveProperty("timestamp");
    });

    it("the OTel event sink compares the times with Date.now by default", () => {
        const otelLogger = { emit : vi.fn() };
        const now = Date.now();
        createOtelEventSink(otelLogger).emit("lag.stall", {}, { time : now - 1_000 });
        createOtelEventSink(otelLogger).emit("lag.stall", {}, { time : now - 3_600_000 });

        expect(otelLogger.emit.mock.calls[0]![0]).toHaveProperty("timestamp", now - 1_000);
        expect(otelLogger.emit.mock.calls[1]![0]).not.toHaveProperty("timestamp");
    });

    it("the OTel event sink leaves out the attributes that are null", () => {
        const otelLogger = { emit : vi.fn() };
        createOtelEventSink(otelLogger).emit("lag.stall", { kind : "hang", nothing : null as unknown as string });

        expect(otelLogger.emit).toHaveBeenCalledWith(expect.objectContaining({ body : "lag.stall kind=hang", attributes : { kind : "hang" } }));
    });

    it("the no-op event sink accepts events", () => {
        expect(() => createNoopEventSink().emit("x", {})).not.toThrow();
    });
});
