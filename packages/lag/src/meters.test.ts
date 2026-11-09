import { describe, expect, it } from "vitest";
import type * as api from "@opentelemetry/api";
import { createNoopMeter, fanOutMeter, type Attributes, type Meter } from "./meters.js";

type Recorded = { meter : string; kind : "histogram" | "counter"; name : string; value : number; attributes? : Attributes | undefined };

/** A meter that keeps each record in `log`, with the name `meter`. */
function recordingMeter(meter : string, log : Recorded[]) : Meter {
    return {
        createHistogram : (name) => ({ record : (value, attributes) => void log.push({ meter, kind : "histogram", name, value, attributes }) }),
        createCounter : (name) => ({ add : (value, attributes) => void log.push({ meter, kind : "counter", name, value, attributes }) }),
    };
}

describe("fanOutMeter", () => {
    it("records each value into each meter, in the order of the list", () => {
        const log : Recorded[] = [];
        const meter = fanOutMeter(recordingMeter("a", log), recordingMeter("b", log));

        meter.createHistogram("lag", { unit : "ms" }).record(12, { kind : "hang" });
        meter.createCounter("hangs", { unit : "1" }).add(1);

        expect(log).toEqual([
            { meter : "a", kind : "histogram", name : "lag", value : 12, attributes : { kind : "hang" } },
            { meter : "b", kind : "histogram", name : "lag", value : 12, attributes : { kind : "hang" } },
            { meter : "a", kind : "counter", name : "hangs", value : 1, attributes : undefined },
            { meter : "b", kind : "counter", name : "hangs", value : 1, attributes : undefined },
        ]);
    });

    it("makes each instrument one time in each meter, with the options of the call", () => {
        const made : string[] = [];
        const counting : Meter = {
            createHistogram : (name, options) => {
                made.push(`histogram ${name} ${options.unit}`);
                return { record() {} };
            },
            createCounter : (name, options) => {
                made.push(`counter ${name} ${options.unit}`);
                return { add() {} };
            },
        };
        const histogram = fanOutMeter(counting, counting).createHistogram("lag", { unit : "ms" });
        histogram.record(1);
        histogram.record(2);

        expect(made).toEqual(["histogram lag ms", "histogram lag ms"]);
    });

    it("gives a meter that records nothing for an empty list", () => {
        expect(() => fanOutMeter().createCounter("hangs", { unit : "1" }).add(1)).not.toThrow();
    });
});

describe("the Meter type", () => {
    it("takes the real Meter of @opentelemetry/api, the no-op meter and a fan-out meter", () => {
        // The type check of the tests is the claim: each assignment compiles.
        const real : Meter = {} as api.Meter;
        const noop : Meter = createNoopMeter();
        const fanOut : Meter = fanOutMeter(real, noop);
        const histogram : api.Histogram = {} as api.Histogram;
        const narrow : ReturnType<Meter["createHistogram"]> = histogram;
        expect([real, noop, fanOut, narrow]).toHaveLength(4);
    });
});
