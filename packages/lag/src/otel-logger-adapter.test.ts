import { vi, expect } from "vitest";
import { createOtelLoggerAdapter, createTeeLogger } from "./otel-logger-adapter.js";

describe("createOtelLoggerAdapter", () => {
    it("emits log records with severityText and body", () => {
        const otelLogger = { emit : vi.fn() };
        const adapter = createOtelLoggerAdapter(otelLogger);

        adapter.log("info", "hello world", null);

        expect(otelLogger.emit).toHaveBeenCalledWith(expect.objectContaining({
            severityText : "info",
            severityNumber : 9,
            body : "hello world",
        }));
    });

    it("maps known severity levels to OTel SeverityNumber", () => {
        const otelLogger = { emit : vi.fn() };
        const adapter = createOtelLoggerAdapter(otelLogger);

        adapter.log("trace", "x", null);
        adapter.log("debug", "x", null);
        adapter.log("info",  "x", null);
        adapter.log("warn",  "x", null);
        adapter.log("error", "x", null);
        adapter.log("fatal", "x", null);

        const calls = otelLogger.emit.mock.calls.map((c) => c[0].severityNumber);
        expect(calls).toEqual([1, 5, 9, 13, 17, 21]);
    });

    it("defaults to INFO severity for unknown levels", () => {
        const otelLogger = { emit : vi.fn() };
        const adapter = createOtelLoggerAdapter(otelLogger);

        adapter.log("custom", "x", null);

        expect(otelLogger.emit.mock.calls[0]![0].severityNumber).toBe(9);
    });

    it("merges object args into attributes", () => {
        const otelLogger = { emit : vi.fn() };
        const adapter = createOtelLoggerAdapter(otelLogger);

        adapter.log("warn", "lag detected", { type : "DriftLag", lagMs : 250 });

        expect(otelLogger.emit.mock.calls[0]![0].attributes).toEqual({
            type : "DriftLag",
            lagMs : 250,
        });
    });

    it("wraps non-object args under 'args' key", () => {
        const otelLogger = { emit : vi.fn() };
        const adapter = createOtelLoggerAdapter(otelLogger);

        adapter.log("info", "x", "string-arg");

        expect(otelLogger.emit.mock.calls[0]![0].attributes).toEqual({ args : "string-arg" });
    });

    it("handles null/undefined args without throwing", () => {
        const otelLogger = { emit : vi.fn() };
        const adapter = createOtelLoggerAdapter(otelLogger);

        adapter.log("info", "x", null);
        adapter.log("info", "y", undefined);

        expect(otelLogger.emit.mock.calls[0]![0].attributes).toEqual({});
        expect(otelLogger.emit.mock.calls[1]![0].attributes).toEqual({});
    });
});

describe("createTeeLogger", () => {
    it("forwards calls to all loggers", () => {
        const a = { log : vi.fn() };
        const b = { log : vi.fn() };
        const tee = createTeeLogger(a, b);

        tee.log("warn", "hi", { x : 1 });

        expect(a.log).toHaveBeenCalledWith("warn", "hi", { x : 1 });
        expect(b.log).toHaveBeenCalledWith("warn", "hi", { x : 1 });
    });

    it("isolates logger errors so one failure doesn't break others", () => {
        const broken = { log : vi.fn(() => { throw new Error("boom"); }) };
        const working = { log : vi.fn() };
        const tee = createTeeLogger(broken, working);

        expect(() => tee.log("info", "x", null)).not.toThrow();
        expect(working.log).toHaveBeenCalled();
    });
});
