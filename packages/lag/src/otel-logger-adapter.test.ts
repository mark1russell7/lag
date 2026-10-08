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

    it("gives the string of an argument that is not a primitive and not an object", () => {
        const otelLogger = { emit : vi.fn() };

        createOtelLoggerAdapter(otelLogger).log("info", "x", Symbol("lag"));

        expect(otelLogger.emit.mock.calls[0]![0].attributes).toEqual({ args : "Symbol(lag)" });
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

describe("createOtelLoggerAdapter attribute encoding", () => {
    it("turns an Error into semantic-convention exception attributes", () => {
        const otelLogger = { emit : vi.fn() };
        const error = new TypeError("bad thing");

        createOtelLoggerAdapter(otelLogger).log("error", "failed", { error, type : "DriftLag" });

        expect(otelLogger.emit.mock.calls[0]![0].attributes).toEqual({
            "exception.type" : "TypeError",
            "exception.message" : "bad thing",
            "exception.stacktrace" : error.stack,
            type : "DriftLag",
        });
    });

    it("JSON-encodes nested objects and keeps primitive arrays", () => {
        const otelLogger = { emit : vi.fn() };

        createOtelLoggerAdapter(otelLogger).log("warn", "x", {
            rect : { x : 1, y : 2 },
            sources : ["cpu", "thermals"],
            skipped : undefined,
        });

        expect(otelLogger.emit.mock.calls[0]![0].attributes).toEqual({
            rect : '{"x":1,"y":2}',
            sources : ["cpu", "thermals"],
        });
    });

    it("keeps booleans, numbers and strings, and leaves out the attributes that are undefined or null", () => {
        const otelLogger = { emit : vi.fn() };

        createOtelLoggerAdapter(otelLogger).log("info", "x", { flag : true, count : 3, name : "drift", gone : undefined, empty : null });

        const attributes = otelLogger.emit.mock.calls[0]![0].attributes as Record<string, unknown>;
        expect(attributes).toEqual({ flag : true, count : 3, name : "drift" });
        expect(Object.keys(attributes).sort()).toEqual(["count", "flag", "name"]);
    });

    it("JSON-encodes an array with values of different types or with objects", () => {
        const otelLogger = { emit : vi.fn() };

        createOtelLoggerAdapter(otelLogger).log("info", "x", { mixed : [1, "a"], objects : [{ a : 1 }] });

        expect(otelLogger.emit.mock.calls[0]![0].attributes).toEqual({ mixed : '[1,"a"]', objects : '[{"a":1}]' });
    });

    it("leaves out the stack trace of an Error that has no stack", () => {
        const otelLogger = { emit : vi.fn() };
        const error = new Error("no stack");
        delete error.stack;

        createOtelLoggerAdapter(otelLogger).log("error", "failed", { error });

        expect(Object.keys(otelLogger.emit.mock.calls[0]![0].attributes as object).sort()).toEqual(["exception.message", "exception.type"]);
    });

    it("gives the string of an object that JSON cannot encode", () => {
        const otelLogger = { emit : vi.fn() };
        const circular : Record<string, unknown> = {};
        circular["self"] = circular;

        createOtelLoggerAdapter(otelLogger).log("info", "x", { circular });

        expect(otelLogger.emit.mock.calls[0]![0].attributes).toEqual({ circular : "[object Object]" });
    });
});
