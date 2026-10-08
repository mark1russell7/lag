import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstrumentedDriftLag } from "./drift-lag.js";
import { createMeasurementConditions, type MeasurementConditions } from "../measurement-conditions.js";
import { createRecordingMeter } from "../test-utils.js";

/** DriftLag on fake timers. `delayOf(step)` gives the extra delay of each timer step, from step 1. */
function setup(delayOf : (step : number) => number, conditions? : MeasurementConditions) {
    let steps = 0;
    const meter = createRecordingMeter();
    const logger = { log : vi.fn() };
    const handle = createInstrumentedDriftLag({
        logger,
        clock : { now : () => Date.now() },
        meter : meter.meter,
        setTimeoutFn : (fn, ms) => setTimeout(fn, ms + delayOf(++steps)) as unknown as number,
        clearTimeoutFn : (id) => clearTimeout(id),
        setIntervalFn : (fn, ms) => setInterval(fn, ms) as unknown as number,
        clearIntervalFn : (id) => clearInterval(id),
    }, conditions);
    return { meter, logger, handle };
}

describe("createInstrumentedDriftLag", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
    });

    afterEach(() => vi.useRealTimers());

    it("records the lag and the baseline of each window, and logs sustained lag through the lag logger", () => {
        // Each fourth step is a block of 200 ms. Thus each window of 20 steps has 1000 ms of lag and 100 ms of idle steps.
        const t = setup(step => (step % 4 === 0 ? 200 : 0));

        // The lag logger writes its warnings after 30 s of idle steps. These steps are in 300 windows of 1100 ms.
        vi.advanceTimersByTime(300 * 1_100);
        t.handle.stop();

        expect(t.handle.monitor).toBeDefined();
        expect(vi.getTimerCount()).toBe(0);
        expect(t.meter.values("lag_drift_histogram").slice(0, 3)).toEqual([1_000, 1_000, 1_000]);
        expect(t.meter.values("lag_drift_baseline_histogram").slice(0, 3)).toEqual([5, 5, 5]);
        expect(t.logger.log).toHaveBeenCalledWith("warn", "Average event loop lag exceeded threshold",
            expect.objectContaining({ wasHidden : false, duration : 2_000, threshold : 100, lag : "1000.0" }));
        expect(t.logger.log).toHaveBeenCalledWith("warn", "Average event loop lag exceeded threshold",
            expect.objectContaining({ wasHidden : false, duration : 5_000, threshold : 50, lag : "1000.0" }));
    });

    it("stop() cancels the windows that wait for evidence", () => {
        const conditions = createMeasurementConditions({
            clock : { now : () => Date.now() },
            setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
            clearTimeoutFn : (id) => clearTimeout(id),
        });
        // The first window has one block of 6 s
        const t = setup(step => (step === 10 ? 6_000 : 0), conditions);
        vi.advanceTimersByTime(6_100);

        t.handle.stop();
        vi.advanceTimersByTime(5_000);

        expect(t.meter.values("lag_drift_histogram")).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });
});
