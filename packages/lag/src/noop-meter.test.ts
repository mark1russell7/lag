import { describe, expect, it } from "vitest";
import { createNoopMeter } from "./noop-meter.js";

describe("createNoopMeter", () => {
    it("gives histograms and counters that accept values and record nothing", () => {
        const meter = createNoopMeter();

        expect(() => meter.createHistogram("lag_drift_histogram", { unit : "ms" }).record(12, { source : "legacy" })).not.toThrow();
        expect(() => meter.createCounter("lag_gc_events", { unit : "{gc}" }).add(1)).not.toThrow();
    });
});
