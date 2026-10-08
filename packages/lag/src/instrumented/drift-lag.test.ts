import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstrumentedDriftLag } from "./drift-lag.js";
import { createMeasurementConditions, type MeasurementConditions } from "../measurement-conditions.js";
import { createRecordingMeter } from "../test-utils.js";
import { SimulatedThread } from "../test-thread.js";
import type { MessageChannelConstructor, MessagePortLike } from "../SchedulingFairnessMonitor.js";

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

describe("createInstrumentedDriftLag with MessageChannel", () => {
    /** A channel whose messages are message tasks of the simulated thread. */
    function simulatedChannel(thread : SimulatedThread) {
        const closed = vi.fn();
        class Channel {
            readonly port1 : MessagePortLike = { postMessage : () => {}, onmessage : null, close : closed };
            readonly port2 : MessagePortLike = {
                postMessage : () => thread.post(() => (this.port1.onmessage as (() => void) | null)?.()),
                onmessage : null,
                close : closed,
            };
        }
        return { Channel : Channel as unknown as MessageChannelConstructor, closed };
    }

    it("probes through a message queue, and closes the queue when it stops", () => {
        const thread = new SimulatedThread(1 / 64);
        thread.timerExtraMs = 1;
        const channel = simulatedChannel(thread);
        const meter = createRecordingMeter();
        const handle = createInstrumentedDriftLag({
            logger : { log : vi.fn() },
            clock : thread.clock,
            meter : meter.meter,
            setTimeoutFn : thread.setTimeout,
            clearTimeoutFn : thread.clearTimeout,
            setIntervalFn : thread.setInterval,
            clearIntervalFn : thread.clearInterval,
            MessageChannel : channel.Channel,
        });
        thread.advance(1_000);

        // One check after the first window: two probes of one step of 6 ms, with messages of 1/64 ms
        expect(thread.postedMessages).toBeGreaterThan(600);
        expect(meter.values("lag_drift_baseline_histogram").at(-1)).toBeCloseTo(6, 1);
        handle.stop();
        expect(channel.closed).toHaveBeenCalledTimes(2);
    });
});
