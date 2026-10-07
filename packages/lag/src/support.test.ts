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
});

describe("event sinks", () => {
    it("the OTel event sink emits a log record with the event name, without empty attributes", () => {
        const otelLogger = { emit : vi.fn() };
        createOtelEventSink(otelLogger).emit("browser.web_vital", {
            name : "INP",
            value : 240,
            missing : undefined as unknown as string,
        });

        expect(otelLogger.emit).toHaveBeenCalledWith({
            eventName : "browser.web_vital",
            severityText : "INFO",
            severityNumber : 9,
            attributes : { name : "INP", value : 240 },
        });
    });

    it("the no-op event sink accepts events", () => {
        expect(() => createNoopEventSink().emit("x", {})).not.toThrow();
    });
});
