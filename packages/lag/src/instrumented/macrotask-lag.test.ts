import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstrumentedMacrotaskLag } from "./macrotask-lag.js";
import { createMeasurementConditions, type MeasurementConditions } from "../measurement-conditions.js";
import { createRecordingMeter } from "../test-utils.js";

/** MacrotaskLag on fake timers. Each zero-delay timeout waits `queueMs` in the task queue. */
function setup(queueMs : number, conditions? : MeasurementConditions) {
    const meter = createRecordingMeter();
    const handle = createInstrumentedMacrotaskLag({
        logger : { log : vi.fn() },
        clock : { now : () => Date.now() },
        meter : meter.meter,
        setTimeoutFn : (fn, ms) => setTimeout(fn, ms + queueMs) as unknown as number,
        clearTimeoutFn : (id) => clearTimeout(id),
        setIntervalFn : (fn, ms) => setInterval(fn, ms) as unknown as number,
        clearIntervalFn : (id) => clearInterval(id),
    }, conditions);
    return { meter, handle };
}

describe("createInstrumentedMacrotaskLag", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
    });

    afterEach(() => vi.useRealTimers());

    it("records the time that a zero-delay timeout waited, one time in 5 s", async () => {
        const t = setup(30);

        await vi.advanceTimersByTimeAsync(5_030);
        t.handle.stop();

        expect(t.handle.monitor).toBeDefined();
        expect(vi.getTimerCount()).toBe(0);
        expect(t.meter.values("lag_macrotask_histogram")).toEqual([30]);
    });

    it("stop() cancels the samples that wait for evidence", async () => {
        const conditions = createMeasurementConditions({
            clock : { now : () => Date.now() },
            setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
            clearTimeoutFn : (id) => clearTimeout(id),
        });
        const t = setup(6_000, conditions);
        await vi.advanceTimersByTimeAsync(11_000);

        t.handle.stop();
        await vi.advanceTimersByTimeAsync(5_000);

        expect(t.meter.values("lag_macrotask_histogram")).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });
});
