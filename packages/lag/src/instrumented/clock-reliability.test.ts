import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstrumentedClockReliability } from "./clock-reliability.js";
import { createRecordingMeter } from "../test-utils.js";

/** A clock that advances by `stepMs` at each read. */
function setup(stepMs : number) {
    let now = 0;
    const meter = createRecordingMeter();
    const handle = createInstrumentedClockReliability({
        logger : { log : vi.fn() },
        clock : { now : () => now },
        meter : meter.meter,
        performance : { timeOrigin : 1_700_000_000_000, now : () => (now += stepMs) },
        setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
        clearTimeoutFn : (id) => clearTimeout(id),
    });
    return { meter, handle };
}

describe("createInstrumentedClockReliability", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("records the resolution of the clock one time, 5 s after the setup", () => {
        const t = setup(0.125);

        vi.advanceTimersByTime(4_999);
        expect(t.meter.values("lag_clock_resolution_histogram")).toEqual([]);
        vi.advanceTimersByTime(1);

        expect(t.meter.values("lag_clock_resolution_histogram")).toEqual([0.125]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("records nothing when the clock did not advance during the measurement", () => {
        const t = setup(0);

        vi.advanceTimersByTime(5_000);

        expect(t.meter.values("lag_clock_resolution_histogram")).toEqual([]);
    });

    it("stop() before the measurement cancels it", () => {
        const t = setup(0.125);

        t.handle.stop();
        vi.advanceTimersByTime(10_000);

        expect(t.meter.values("lag_clock_resolution_histogram")).toEqual([]);
    });
});
