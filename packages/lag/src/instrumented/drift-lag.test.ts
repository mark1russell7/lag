import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstrumentedDriftLag } from "./drift-lag.js";
import { createMeasurementConditions, type MeasurementConditions } from "../measurement-conditions.js";
import type { FrameViewport } from "../frame-viewport.js";
import { createRecordingMeter, expectCatalogInstruments } from "../test-utils.js";
import { SimulatedThread } from "../test-thread.js";
import type { MessageChannelConstructor, MessagePortLike } from "../SchedulingFairnessMonitor.js";
import type { PageChangeSource } from "../page-change.js";

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

    it("pauses while its frame is off the screen, where WebKit makes each nested timer wait approximately 1 s", () => {
        const listeners = new Set<(shown : boolean) => void>();
        let shown = true;
        const viewport : FrameViewport = {
            isShown : () => shown,
            subscribe(listener) {
                listeners.add(listener);
                return () => { listeners.delete(listener); };
            },
        };
        const move = (value : boolean) : void => {
            shown = value;
            for (const listener of [...listeners]) listener(value);
        };
        const conditions = createMeasurementConditions({
            clock : { now : () => Date.now() },
            setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
            clearTimeoutFn : (id) => clearTimeout(id),
            viewport,
        });
        const t = setup(() => (shown ? 0 : 1_000), conditions);
        vi.advanceTimersByTime(2_000);
        const before = t.meter.values("lag_drift_histogram").length;

        move(false);
        vi.advanceTimersByTime(10_000);
        const offscreen = t.meter.values("lag_drift_histogram").length;
        move(true);
        vi.advanceTimersByTime(2_000);
        t.handle.stop();

        const values = t.meter.values("lag_drift_histogram");
        expect(before).toBeGreaterThan(0);
        expect(offscreen).toBe(before);
        expect(values.length).toBeGreaterThan(offscreen);
        expect(Math.max(...values)).toBeLessThan(10);
        expect(listeners.size).toBe(0);
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

    /** A monitor at a grid of 1 s. The block starts off the grid. `during` starts after the block, before the next step. */
    function throttledBlock(
        recordThrottledSteps : boolean | undefined,
        during? : (conditions : MeasurementConditions, now : number) => void,
        pageChanges? : PageChangeSource,
        beforeGridMs = 3_000,
    ) {
        const thread = new SimulatedThread(1 / 64);
        thread.nestedTimerAlignmentMs = 4;
        const conditions = createMeasurementConditions({
            clock : thread.clock,
            setTimeoutFn : thread.setTimeout,
            clearTimeoutFn : thread.clearTimeout,
        });
        const meter = createRecordingMeter();
        const logger = { log : vi.fn() };
        const handle = createInstrumentedDriftLag({
            logger,
            clock : thread.clock,
            meter : meter.meter,
            setTimeoutFn : thread.setTimeout,
            clearTimeoutFn : thread.clearTimeout,
            setIntervalFn : thread.setInterval,
            clearIntervalFn : thread.clearInterval,
            MessageChannel : simulatedChannel(thread).Channel,
            ...(pageChanges ? { pageChanges } : {}),
        }, conditions, recordThrottledSteps === undefined ? undefined : { recordThrottledSteps });
        thread.advance(beforeGridMs);
        thread.setNestedTimerAlignment(1_000);
        thread.advance(6_370);
        thread.post(() => thread.busy(2_500));
        thread.advance(2_500);
        during?.(conditions, thread.now);
        thread.advance(5_000);
        handle.stop();
        const recorded = meter.instruments().find(instrument => instrument.name === "lag_drift_histogram")?.values ?? [];
        const unread = meter.instruments().find(instrument => instrument.name === "lag_drift_unread_steps")?.values ?? [];
        const starts = meter.instruments().find(instrument => instrument.name === "lag_drift_throttle_starts")?.values ?? [];
        return { marked : recorded.filter(({ attributes }) => attributes?.["source"] === "throttled-step"), recorded, unread, starts, meter, logger };
    }

    it("marks the value of a long throttled step, with the option", () => {
        const { marked, recorded } = throttledBlock(true);
        expect(marked).toHaveLength(1);
        expect(marked[0]?.value).toBeGreaterThan(1_400);
        expect(marked[0]?.value).toBeLessThanOrEqual(2_500);
        expect(recorded.filter(({ value, attributes }) => value > 500 && attributes === undefined)).toEqual([]);
    });

    it("gives no value of a long throttled step by default, and it counts the step as unread", () => {
        for (const option of [undefined, false]) {
            const { recorded, unread, meter } = throttledBlock(option);
            expect(recorded.filter(({ value }) => value > 500)).toEqual([]);
            expect(unread).toEqual([{ value : 1, attributes : { mode : "option-off", page : "not-read" } }]);
            expectCatalogInstruments(meter);
        }
    });

    /** A source that saw no change: the clock counts from its start, at the creation of the monitor. */
    const stillPage : PageChangeSource = { observe : () => () => {}, animating : () => false };

    it("gives the time since the last change of the page to the throttle counters: idle from 30 s, changed before", () => {
        // The block ends the throttling, and the throttling starts again after it: two starts
        const late = throttledBlock(undefined, undefined, stillPage, 31_000);
        expect(late.starts).toEqual([{ value : 1, attributes : { page : "idle" } }, { value : 1, attributes : { page : "idle" } }]);
        expect(late.unread).toEqual([{ value : 1, attributes : { mode : "option-off", page : "idle" } }]);
        const start = late.logger.log.mock.calls.find(([, message]) => String(message).includes("throttles the timers"));
        expect(start?.[2]).toMatchObject({ sinceChangeMs : expect.any(Number) as number });
        expect((start?.[2] as { sinceChangeMs : number }).sinceChangeMs).toBeGreaterThanOrEqual(31_000);

        const early = throttledBlock(undefined, undefined, stillPage);
        expect(early.starts.map(({ attributes }) => attributes)).toEqual([{ page : "changed" }, { page : "changed" }]);
        expect(throttledBlock(undefined).starts.map(({ attributes }) => attributes)).toEqual([{ page : "not-read" }, { page : "not-read" }]);
    });

    it("gives no time when the change clock throws, and the chain of steps goes on", () => {
        const broken : PageChangeSource = { observe : () => () => {}, animating : () => { throw new Error("broken"); } };
        const { starts, unread, logger } = throttledBlock(undefined, undefined, broken);
        expect(starts.map(({ attributes }) => attributes)).toEqual([{ page : "not-read" }, { page : "not-read" }]);
        expect(unread).toEqual([{ value : 1, attributes : { mode : "option-off", page : "not-read" } }]);
        expect(logger.log).toHaveBeenCalledWith("error", "Error in the change clock of DriftLag.", expect.anything());
    });

    it("discards the value when an unreliable interval overlaps the long step, and keeps it when the interval ends before the step", () => {
        const { marked } = throttledBlock(true, (conditions, now) => conditions.tracker.add(now - 2_000, now - 1_500, "suspend"));
        expect(marked).toEqual([]);
        const before = throttledBlock(true, (conditions, now) => conditions.tracker.add(now - 7_000, now - 6_500, "suspend"));
        expect(before.marked).toHaveLength(1);
    });

    it("gives the throttled timers of a visible page to the conditions: a monitor of the rendering pauses", () => {
        const thread = new SimulatedThread(1 / 64);
        thread.nestedTimerAlignmentMs = 4;
        const channel = simulatedChannel(thread);
        const conditions = createMeasurementConditions({
            clock : thread.clock,
            setTimeoutFn : thread.setTimeout,
            clearTimeoutFn : thread.clearTimeout,
        });
        const rendering = { start : vi.fn(), stop : vi.fn() };
        conditions.pauseWhileHidden(rendering, { throttled : true });
        const handle = createInstrumentedDriftLag({
            logger : { log : vi.fn() },
            clock : thread.clock,
            meter : createRecordingMeter().meter,
            setTimeoutFn : thread.setTimeout,
            clearTimeoutFn : thread.clearTimeout,
            setIntervalFn : thread.setInterval,
            clearIntervalFn : thread.clearInterval,
            MessageChannel : channel.Channel,
        }, conditions);
        thread.advance(3_000);
        // A page that Safari does not show: the grid of the nested timers is 1 s
        thread.setNestedTimerAlignment(1_000);
        thread.advance(5_000);
        expect(rendering.stop).toHaveBeenCalledTimes(1);
        thread.setNestedTimerAlignment(4);
        thread.advance(2_000);
        expect(rendering.start).toHaveBeenCalledTimes(1);

        handle.stop();
        conditions.dispose();
    });
});
