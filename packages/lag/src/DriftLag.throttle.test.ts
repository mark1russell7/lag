import { describe, expect, it, vi } from "vitest";
import { highFrequencyLagIntervalMs } from "./constants.js";
import { DriftLag } from "./DriftLag.js";
import { SimulatedThread } from "./test-thread.js";

type Window = { endAt : number; lag : number };

/**
 * DriftLag on a simulated thread with the timer alignment of WebKit: 4 ms
 * normally. A page that Safari does not show ("visually idle") gets an
 * alignment of 1 s for its nested timers,
 * also with `visibilityState` "visible" (WebKit `Page::updateTimerThrottlingState`).
 * A frame off the screen gets the same alignment (`LocalFrameView.cpp`).
 */
function createDriftLag(withPostTask = true) {
    const thread = new SimulatedThread(1 / 64);
    thread.nestedTimerAlignmentMs = 4;
    const windows : Window[] = [];
    const logger = { log : vi.fn() };
    const monitor = new DriftLag(
        highFrequencyLagIntervalMs,
        (lag) => windows.push({ endAt : thread.now, lag }),
        logger,
        thread.setInterval,
        thread.clearInterval,
        thread.setTimeout,
        thread.clearTimeout,
        thread.clock,
        withPostTask ? { postTask : thread.post } : {},
    );
    return { thread, monitor, windows, logger };
}

const lagsBetween = (windows : readonly Window[], from : number, to : number) : number[] =>
    windows.filter(w => w.endAt >= from && w.endAt < to).map(w => w.lag);

describe("DriftLag with throttled timers", () => {
    it("records no window while the nested timers wait for a grid of 1 s on an idle thread, and records windows again after", () => {
        const t = createDriftLag();
        t.thread.advance(3_000);
        t.thread.setNestedTimerAlignment(1_000);
        const throttledAt = t.thread.now;
        t.thread.advance(30_000);
        t.thread.setNestedTimerAlignment(4);
        const endedAt = t.thread.now;
        t.thread.advance(3_000);
        t.monitor.stop();

        expect(lagsBetween(t.windows, throttledAt, endedAt)).toEqual([]);
        const after = lagsBetween(t.windows, endedAt, Infinity);
        expect(after.length).toBeGreaterThan(20);
        // The first windows after the first start have up to 18 ms of lag on the grid of 4 ms (refer to DriftLag.power.test.ts)
        expect(Math.max(...lagsBetween(t.windows, 1_000, Infinity))).toBeLessThan(5);
        expect(t.logger.log).toHaveBeenCalledWith("info", "DriftLag: the browser throttles the timers. The windows pause.",
            expect.objectContaining({ type : "LagMonitor", subtype : "DriftLag" }));
        expect(t.logger.log).toHaveBeenCalledWith("info", "DriftLag: the timers are not throttled. The windows continue.",
            expect.objectContaining({ type : "LagMonitor", subtype : "DriftLag" }));
    });

    // The step in which the throttling starts or ends can have each duration up to 1 s: WebKit aligns the
    // timer that waits again (`TimerBase::didChangeAlignmentInterval`). A window must not end with it.
    // A throttled step of 40 ms or less is a step of the window, as a block of that length is.
    it("gives no lag for a throttling that starts at any time in the grid and in a window", () => {
        let largest = 0;
        for (let offsetMs = 0; offsetMs < 1_000; offsetMs += 7) {
            const t = createDriftLag();
            t.thread.advance(3_000 + offsetMs);
            const throttledAt = t.thread.now;
            t.thread.setNestedTimerAlignment(1_000);
            t.thread.advance(6_000);
            t.monitor.stop();
            largest = Math.max(largest, ...lagsBetween(t.windows, throttledAt, Infinity));
            expect(t.logger.log).toHaveBeenCalledWith("info", "DriftLag: the browser throttles the timers. The windows pause.", expect.anything());
        }
        expect(largest).toBeLessThan(40);
    });

    it("gives no lag for a throttling that ends at any time in the grid", () => {
        let largest = 0;
        for (let offsetMs = 0; offsetMs < 1_000; offsetMs += 7) {
            const t = createDriftLag();
            t.thread.advance(3_000);
            t.thread.setNestedTimerAlignment(1_000);
            t.thread.advance(6_000 + offsetMs);
            const endedAt = t.thread.now;
            t.thread.setNestedTimerAlignment(4);
            t.thread.advance(2_000);
            t.monitor.stop();
            const after = lagsBetween(t.windows, endedAt, Infinity);
            expect(after.length).toBeGreaterThan(10);
            // A window that started before the step in which the throttling ended would have negative lag
            expect(Math.min(...after)).toBeGreaterThan(-4);
            largest = Math.max(largest, ...after);
        }
        expect(largest).toBeLessThan(5);
    });

    it("finds the throttling also when it starts before the first step", () => {
        const t = createDriftLag();
        t.thread.setNestedTimerAlignment(1_000);
        t.thread.advance(20_000);
        t.monitor.stop();

        // The first 10 steps are not aligned (WebKit aligns from the nesting level 10), thus the first window is valid
        expect(t.windows.length).toBeLessThanOrEqual(1);
        expect(Math.max(0, ...t.windows.map(w => w.lag))).toBeLessThan(5);
    });

    it("uses few messages: one probe of 50 ms to find the throttling, and one each 30 throttled steps", () => {
        const t = createDriftLag();
        t.thread.advance(3_000);
        t.thread.setNestedTimerAlignment(1_000);
        t.thread.advance(2_500);
        const before = t.thread.postedMessages;
        t.thread.advance(60_000);

        // A probe of 50 ms posts one message for each task of 1/64 ms. A probe of a full step of 1 s would post 64,000.
        const posted = t.thread.postedMessages - before;
        expect(posted).toBeGreaterThan(2 * 50 * 64 - 10);
        expect(posted).toBeLessThan(2 * 50 * 64 + 10);
        t.monitor.stop();
    });

    it("records a load of equal long tasks as lag", () => {
        const t = createDriftLag();
        t.thread.advance(3_000);
        const loadAt = t.thread.now;
        t.thread.load(600, loadAt + 10_000);
        t.thread.advance(12_000);
        t.monitor.stop();

        // A window has a number of steps, thus a window of steps of 600 ms takes some seconds
        const lags = lagsBetween(t.windows, loadAt, loadAt + 12_000);
        expect(lags.reduce((sum, lag) => sum + lag, 0)).toBeGreaterThan(9_000);
        expect(Math.min(...lagsBetween(t.windows, loadAt + 1_000, loadAt + 10_000))).toBeGreaterThan(500);
        expect(t.logger.log).not.toHaveBeenCalledWith("info", expect.stringContaining("throttles"), expect.anything());
    });

    it("records a load of tasks of 100 ms as lag, without a probe: only a second long step of 500 ms or more starts a check", () => {
        const t = createDriftLag();
        t.thread.advance(3_000);
        const loadAt = t.thread.now;
        const before = t.thread.postedMessages;
        t.thread.load(100, loadAt + 5_000, 0);
        t.thread.advance(6_000);
        t.monitor.stop();

        // The windows end during the load: the first long step of a row holds a window for one step only
        const lags = lagsBetween(t.windows, loadAt + 500, loadAt + 5_000);
        expect(lags.length).toBeGreaterThanOrEqual(3);
        expect(Math.min(...lags)).toBeGreaterThan(50);
        // The messages are the tasks of the load: one each 100 ms. No probe operated.
        expect(t.thread.postedMessages - before).toBeLessThan(5);
    });

    it("ends the throttling when a check operates during the first short step", () => {
        const t = createDriftLag();
        t.thread.advance(3_000);
        t.thread.setNestedTimerAlignment(1_000);
        // The throttling starts at the third step: 3370 ms (the partial step), 4370 ms and 5370 ms.
        // The 30th throttled step ends at 35370 ms, and its successor has a check.
        t.thread.advance(35_000 - t.thread.now);
        t.thread.setNestedTimerAlignment(4);
        t.thread.advance(3_000);
        t.monitor.stop();

        expect(t.logger.log).toHaveBeenCalledWith("info", "DriftLag: the timers are not throttled. The windows continue.",
            expect.objectContaining({ stepMs : expect.any(Number) }));
        const end = t.logger.log.mock.calls.find(call => call[1] === "DriftLag: the timers are not throttled. The windows continue.")!;
        expect((end[2] as { stepMs : number }).stepMs).toBeLessThan(50);
        const lags = lagsBetween(t.windows, 36_000, Infinity);
        expect(lags.length).toBeGreaterThan(15);
        expect(Math.max(...lags)).toBeLessThan(5);
    });

    it("records a block as lag without a probe: one long step does not start a check", () => {
        const t = createDriftLag();
        t.thread.advance(3_000);
        const before = t.thread.postedMessages;
        t.thread.post(() => t.thread.busy(800));
        t.thread.advance(3_000);
        t.monitor.stop();

        const lags = t.windows.map(w => w.lag);
        expect(Math.max(...lags)).toBeGreaterThan(790);
        expect(Math.max(...lags)).toBeLessThan(810);
        expect(lags.filter(lag => lag > 100)).toHaveLength(1);
        // The message of the block only
        expect(t.thread.postedMessages - before).toBe(1);
    });

    it("records a block in the warm-up after a restart without a probe", () => {
        const t = createDriftLag();
        t.thread.advance(3_000);
        // A long step before the stop: the state of the check starts again
        t.thread.post(() => t.thread.busy(100));
        t.thread.advance(10);
        t.monitor.stop();
        t.thread.advance(500);
        const before = t.thread.postedMessages;
        t.monitor.start();
        t.thread.advance(20);
        t.thread.post(() => t.thread.busy(800));
        t.thread.advance(2_000);
        t.monitor.stop();

        expect(Math.max(...t.windows.map(w => w.lag))).toBeGreaterThan(790);
        expect(t.thread.postedMessages - before).toBe(1);
    });

    it("records a load that starts when the throttling ends, at the next check of the throttled steps", () => {
        const t = createDriftLag();
        t.thread.advance(3_000);
        t.thread.setNestedTimerAlignment(1_000);
        t.thread.advance(10_000);
        // The load gives steps of 600 ms, longer than the shortest throttled step
        t.thread.setNestedTimerAlignment(4);
        const loadAt = t.thread.now;
        t.thread.load(600, loadAt + 40_000);
        t.thread.advance(40_000);
        t.monitor.stop();

        // The check comes after not more than 30 steps of 600 ms. The window after the check starts with
        // the step of the check: a window of 14 steps of 600 ms has less than 9 s of lag.
        const lags = lagsBetween(t.windows, loadAt, loadAt + 40_000);
        expect(lagsBetween(t.windows, loadAt, loadAt + 30 * 600 + 9_000).length).toBeGreaterThan(0);
        expect(lags.length).toBeGreaterThan(2);
        expect(Math.min(...lags)).toBeGreaterThan(500);
        expect(Math.max(...lags)).toBeLessThan(9_000);
    });

    it("finds no throttling when a task of more than half of the probe starts with each step", () => {
        // The check needs a thread that was idle during more than half of the probe (25 ms). Here, a task
        // of 30 ms follows each step, thus the check cannot tell the throttling from a load.
        const thread = new SimulatedThread(1 / 64);
        thread.nestedTimerAlignmentMs = 4;
        let taskMs = 0;
        const logger = { log : vi.fn() };
        const monitor = new DriftLag(
            highFrequencyLagIntervalMs,
            () => {},
            logger,
            thread.setInterval,
            thread.clearInterval,
            (callback, ms) => thread.setTimeout(() => {
                callback();
                if (taskMs > 0) thread.post(() => thread.busy(taskMs));
            }, ms),
            thread.clearTimeout,
            thread.clock,
            { postTask : thread.post },
        );
        thread.advance(3_000);
        thread.setNestedTimerAlignment(1_000);
        taskMs = 30;
        thread.advance(10_000);
        monitor.stop();

        expect(logger.log).not.toHaveBeenCalledWith("info", "DriftLag: the browser throttles the timers. The windows pause.", expect.anything());
    });

    it("does not look for throttling without postTask", () => {
        const t = createDriftLag(false);
        t.thread.advance(3_000);
        t.thread.setNestedTimerAlignment(1_000);
        const throttledAt = t.thread.now;
        t.thread.advance(30_000);
        t.monitor.stop();

        // Without a probe, the monitor cannot tell the throttling from a load
        expect(Math.max(...lagsBetween(t.windows, throttledAt, Infinity))).toBeGreaterThan(500);
        expect(t.thread.postedMessages).toBe(0);
    });

    it("starts again without the throttled state after stop() and start()", () => {
        const t = createDriftLag();
        t.thread.advance(3_000);
        t.thread.setNestedTimerAlignment(1_000);
        t.thread.advance(10_000);
        t.monitor.stop();
        t.thread.setNestedTimerAlignment(4);
        t.thread.advance(1_000);
        const restartAt = t.thread.now;
        t.monitor.start();
        t.thread.advance(3_000);
        t.monitor.stop();

        const lags = lagsBetween(t.windows, restartAt, Infinity);
        expect(lags.length).toBeGreaterThan(20);
        expect(Math.max(...lags)).toBeLessThan(5);
    });
});
