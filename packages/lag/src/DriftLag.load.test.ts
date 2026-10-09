import { describe, expect, it, vi } from "vitest";
import { highFrequencyLagIntervalMs } from "./constants.js";
import { DriftLag, type DriftLagOptions } from "./DriftLag.js";
import { SimulatedThread } from "./test-thread.js";

type Window = { endAt : number; lag : number; windowMs : number };

/**
 * DriftLag on a simulated thread. An idle step takes 5 ms plus
 * `timerExtraMs`. By default, the monitor probes with the message queue of
 * the thread.
 */
function createDriftLag(timerExtraMs : number, probe = true, options : DriftLagOptions = {}) {
    const thread = new SimulatedThread(1 / 64);
    thread.timerExtraMs = timerExtraMs;
    const windows : Window[] = [];
    const monitor : DriftLag = new DriftLag(
        highFrequencyLagIntervalMs,
        (lag) => windows.push({ endAt : thread.now, lag, windowMs : monitor.getLastWindowMs() }),
        { log : () => {} },
        thread.setInterval,
        thread.clearInterval,
        thread.setTimeout,
        thread.clearTimeout,
        thread.clock,
        probe ? { ...options, postTask : thread.post } : options,
    );
    return { thread, monitor, windows };
}

/** The lag of the windows that end in [from, to), as a fraction of the length of these windows. */
function lagFraction(windows : readonly Window[], from : number, to : number) : number {
    const part = windows.filter(w => w.endAt >= from && w.endAt < to);
    expect(part.length).toBeGreaterThan(0);
    return part.reduce((sum, w) => sum + w.lag, 0) / part.reduce((sum, w) => sum + w.windowMs, 0);
}

function maxLag(windows : readonly Window[], from : number) : number {
    return Math.max(...windows.filter(w => w.endAt >= from).map(w => w.lag));
}

describe("DriftLag during a sustained load", () => {
    // Before the probe, the monitor accepted a row of 10 equal steps as a new
    // timer granularity. A browser test measured the effect in each engine.
    // With message tasks of 20 ms, WebKit gave rows of 31 ms steps: the lag was
    // approximately 0 for 4 s. Chromium gave the same with timer tasks of 30 ms.
    it("reports equal tasks of 20 ms as lag, also after 5 s", () => {
        const d = createDriftLag(1);
        d.thread.advance(2_000);
        const start = d.thread.now;
        d.thread.load(20, start + 5_000);
        d.thread.advance(5_000);

        // Each step waits for one task: 20 ms of each step of 20 ms, minus the idle step of 6 ms
        expect(lagFraction(d.windows, start + 3_000, start + 5_000)).toBeGreaterThan(0.65);
        expect(d.monitor.getBaselineMs()).toBeCloseTo(6, 0);
        // A window does not wait for a busy row: it has round(100 / 6) = 17 steps of 20 ms
        const late = d.windows.filter(w => w.endAt >= start + 3_000 && w.endAt < start + 5_000);
        expect(Math.max(...late.map(w => w.windowMs))).toBeLessThan(17 * 20 + 10);
        d.monitor.stop();
    });

    it("reported the same load as a new granularity without a probe", () => {
        const d = createDriftLag(1, false);
        d.thread.advance(2_000);
        const start = d.thread.now;
        d.thread.load(20, start + 5_000);
        d.thread.advance(5_000);

        expect(lagFraction(d.windows, start + 3_000, start + 5_000)).toBeLessThan(0.05);
        expect(d.monitor.getBaselineMs()).toBeCloseTo(20, 0);
        d.monitor.stop();
    });

    it("reports equal timer tasks of 30 ms, 5 ms apart, as lag", () => {
        const d = createDriftLag(1);
        d.thread.advance(2_000);
        const start = d.thread.now;
        // A timer of 4 ms: the clamp of nested timers, plus the extra delay of the thread
        d.thread.load(30, start + 5_000, 4);
        d.thread.advance(5_000);

        expect(lagFraction(d.windows, start + 3_000, start + 5_000)).toBeGreaterThan(0.6);
        expect(d.monitor.getBaselineMs()).toBeCloseTo(6, 0);
        d.monitor.stop();
    });

    // With steps of 15.6 ms, a step of 20 ms is in the jitter limit of the
    // baseline (the median plus half of the median). Thus, without a probe,
    // the baseline increased to 20 ms in Firefox, and the lag went to 0.
    it("reports equal tasks of 20 ms as lag when the idle step takes 15.6 ms", () => {
        const d = createDriftLag(10.6);
        d.thread.advance(2_000);
        const start = d.thread.now;
        d.thread.load(20, start + 5_000);
        d.thread.advance(5_000);

        expect(lagFraction(d.windows, start + 3_000, start + 5_000)).toBeGreaterThan(0.15);
        expect(d.monitor.getBaselineMs()).toBeCloseTo(15.6, 0);
        d.monitor.stop();
    });

    it("reported less lag without a probe when the idle step takes 15.6 ms", () => {
        const d = createDriftLag(10.6, false);
        d.thread.advance(2_000);
        const start = d.thread.now;
        d.thread.load(20, start + 5_000);
        d.thread.advance(5_000);

        expect(lagFraction(d.windows, start + 3_000, start + 5_000)).toBeLessThan(0.05);
        d.monitor.stop();
    });

    it("reports no lag after the load, and the probes stop", () => {
        const d = createDriftLag(1);
        d.thread.advance(2_000);
        const loadEnd = d.thread.now + 3_000;
        d.thread.load(20, loadEnd);
        d.thread.advance(3_000 + 500);
        const posted = d.thread.postedMessages;
        d.thread.advance(2_000);

        // After the load, the recent steps contain the busy steps. A probe shows an idle step of 6 ms,
        // thus the monitor removes them, and it measures with the idle baseline.
        expect(maxLag(d.windows, loadEnd + 500)).toBeLessThan(1);
        expect(d.monitor.getBaselineMs()).toBeCloseTo(6, 0);
        expect(d.thread.postedMessages).toBe(posted);
        d.monitor.stop();
    });

    it("measures a block after the load correctly", () => {
        const d = createDriftLag(1);
        d.thread.advance(2_000);
        d.thread.load(20, d.thread.now + 3_000);
        d.thread.advance(4_000);
        d.windows.length = 0;
        d.thread.setTimeout(() => d.thread.busy(300), 0);
        d.thread.advance(1_000);

        expect(maxLag(d.windows, 0)).toBeGreaterThan(290);
        expect(maxLag(d.windows, 0)).toBeLessThan(310);
        d.monitor.stop();
    });

    it("finds the idle baseline when the monitor starts during a load", () => {
        const d = createDriftLag(1);
        d.thread.load(20, 2_000);
        d.thread.advance(2_000 + 500);
        const idleFrom = d.thread.now;
        d.thread.advance(2_000);

        // Before the first idle probe, the baseline comes from the busy steps. The first idle probe confirms 6 ms.
        expect(d.monitor.getBaselineMs()).toBeCloseTo(6, 0);
        expect(maxLag(d.windows, idleFrom + 500)).toBeLessThan(1);
        d.monitor.stop();
    });

    it("removes the busy steps with one check after a load, when the busy steps are in the jitter limit", () => {
        // Steps of 20 ms are in the jitter limit of steps of 15.6 ms. Thus they stay in the recent baseline
        // until they leave the 100 recent steps. A check that agrees with the confirmed value removes them.
        const d = createDriftLag(10.6);
        d.thread.advance(2_000);
        const loadEnd = d.thread.now + 2_000;
        d.thread.load(20, loadEnd);
        d.thread.runUntil(loadEnd + 300);
        const posted = d.thread.postedMessages;
        d.thread.advance(1_000);

        expect(d.monitor.getBaselineMs()).toBeCloseTo(15.6, 1);
        // Not more than one check: two probes of 15.6 ms, with messages of 1/64 ms
        expect(d.thread.postedMessages - posted).toBeLessThan(2 * 15.6 * 64 + 10);
        d.monitor.stop();
    });

    it("finds the idle baseline of 15.6 ms when the monitor starts during a load of 20 ms tasks", () => {
        // The idle steps are in the jitter limit of the busy steps, thus no row starts. The first idle
        // probe gives the idle step, because the recent baseline does not agree with it.
        const d = createDriftLag(10.6);
        d.thread.load(20, 2_000);
        d.thread.advance(2_000 + 500);
        const idleFrom = d.thread.now;
        d.thread.advance(2_000);

        expect(d.monitor.getBaselineMs()).toBeCloseTo(15.6, 1);
        expect(maxLag(d.windows, idleFrom)).toBeLessThan(1);
        d.monitor.stop();
    });
});

describe("DriftLag with a probe when the timer granularity changes", () => {
    it("accepts a coarser granularity on an idle thread after 10 steps, with no lag", () => {
        const d = createDriftLag(1);
        d.thread.advance(3_000);
        expect(d.monitor.getBaselineMs()).toBeCloseTo(6, 1);
        const change = d.thread.now;
        d.thread.timerExtraMs = 11;
        d.thread.advance(3_000);

        expect(maxLag(d.windows, change)).toBeLessThan(1);
        expect(d.monitor.getBaselineMs()).toBeCloseTo(16, 1);
        d.monitor.stop();
    });

    it("accepts the new granularity two steps later than without a probe: the probed step and the next step are not in the row", () => {
        const withProbe = createDriftLag(1);
        const without = createDriftLag(1, false);
        for (const d of [withProbe, without]) {
            d.thread.advance(3_000);
            d.thread.timerExtraMs = 11;
            // One step of 6 ms started before the change, then 9 steps of 16 ms come
            d.thread.advance(6 + 9 * 16);
            expect(d.monitor.getBaselineMs()).toBeCloseTo(6, 1);
        }

        // The 10th step of 16 ms
        withProbe.thread.advance(16.5);
        without.thread.advance(16.5);
        expect(withProbe.monitor.getBaselineMs()).toBeCloseTo(6, 1);
        expect(without.monitor.getBaselineMs()).toBeCloseTo(16, 1);
        // The 11th and the 12th step of 16 ms: the 6th step was probed, and the 7th step came after the probe
        withProbe.thread.advance(16);
        expect(withProbe.monitor.getBaselineMs()).toBeCloseTo(6, 1);
        withProbe.thread.advance(16);
        expect(withProbe.monitor.getBaselineMs()).toBeCloseTo(16, 1);
        withProbe.monitor.stop();
        without.monitor.stop();
    });

    it("accepts a finer granularity with no probe", () => {
        const d = createDriftLag(11);
        d.thread.advance(3_000);
        const posted = d.thread.postedMessages;
        const change = d.thread.now;
        d.thread.timerExtraMs = 1;
        d.thread.advance(3_000);

        expect(d.thread.postedMessages).toBe(posted);
        expect(maxLag(d.windows, change)).toBeLessThan(1);
        expect(d.monitor.getBaselineMs()).toBeCloseTo(6, 1);
        d.monitor.stop();
    });

    it("confirms a small increase of the granularity with a probe", () => {
        // An increase of 3 ms starts no row (the jitter limit is 4 ms). The baseline follows the median.
        const d = createDriftLag(1);
        d.thread.advance(3_000);
        d.thread.timerExtraMs = 4;
        d.thread.advance(5_000);

        expect(d.monitor.getBaselineMs()).toBeCloseTo(9, 1);
        expect(maxLag(d.windows, d.thread.now - 2_000)).toBeLessThan(1);
        d.monitor.stop();
    });

    it("does one check on an idle thread, after the first window", () => {
        const d = createDriftLag(1);
        // The first window has 20 steps of 6 ms
        d.thread.advance(20 * 6 - 1);
        expect(d.thread.postedMessages).toBe(0);
        d.thread.advance(500);
        const posted = d.thread.postedMessages;
        d.thread.advance(5_000);

        // One check after the first window: two probes of one step, with messages of 1/64 ms
        expect(posted).toBeGreaterThan(600);
        expect(posted).toBeLessThan(900);
        expect(d.thread.postedMessages).toBe(posted);
        d.monitor.stop();
    });

    it("adds the first step after the 11 warm-up steps to the recent steps", () => {
        const d = createDriftLag(1);
        d.thread.advance(11 * 6);
        expect(d.monitor.getBaselineMs()).toBe(5);
        d.thread.advance(6);

        expect(d.monitor.getBaselineMs()).toBe(6);
        d.monitor.stop();
    });

    it("stops a probe when the monitor stops", () => {
        const d = createDriftLag(1);
        // The first window ends after 20 steps, and the next step starts the probe
        d.thread.advance(20 * 6 + 3);
        d.monitor.stop();
        const posted = d.thread.postedMessages;
        d.thread.advance(100);

        expect(posted).toBeGreaterThan(0);
        // The message that waited at stop() starts, but it posts no other message
        expect(d.thread.postedMessages).toBe(posted);
    });
});

/** The change times of the granularity: 240 times, 0.5 ms apart, after 3 s on an idle thread. */
const CHANGE_OFFSETS = Array.from({ length : 240 }, (_, i) => i / 2);

describe("DriftLag when the granularity changes at any time in a window", () => {
    // These tests found two library bugs. (1) A window with an accepted row used the new baseline also
    // for its steps before the row. From 15.6 ms to 5.7 ms, 115 of 240 change times gave more than
    // 20 ms of lag (up to 49.5 ms). (2) With a probe, a row of longer steps needs 12 steps, because the
    // probed step and the step after it are not in the row. The window waited for not more than 10
    // steps after its normal length, thus 11 of 240 change times gave a window of 108.9 ms of lag.
    for (const [fromMs, toMs, probe] of [[10.6, 0.7, true], [10.6, 0.7, false], [0.7, 10.6, true], [0.7, 10.6, false]] as const) {
        it(`gives no lag on an idle thread when the steps change from ${5 + fromMs} ms to ${5 + toMs} ms (probe: ${probe})`, () => {
            let largest = -Infinity;
            for (const offsetMs of CHANGE_OFFSETS) {
                const d = createDriftLag(fromMs, probe);
                d.thread.advance(3_000 + offsetMs);
                const change = d.thread.now;
                d.thread.timerExtraMs = toMs;
                d.thread.advance(2_000);
                largest = Math.max(largest, maxLag(d.windows, change));
                d.monitor.stop();
            }

            expect(largest).toBeLessThan(1);
        });
    }

    // The same bug hid a block. For a coarser granularity, the window gave the new baseline of 15.6 ms to
    // its steps of 5.7 ms before the row. Thus its lag was negative, and the factory recorded it as 0.
    it("measures a block of 100 ms just before a change to a coarser granularity", () => {
        const recorded : number[] = [];
        for (const offsetMs of CHANGE_OFFSETS) {
            const d = createDriftLag(0.7, false);
            d.thread.advance(3_000 + offsetMs);
            const change = d.thread.now;
            d.thread.post(() => d.thread.busy(100));
            d.thread.timerExtraMs = 10.6;
            d.thread.advance(2_000);
            // The factory records a negative lag as 0
            recorded.push(d.windows.filter(w => w.endAt >= change).reduce((sum, w) => sum + Math.max(0, w.lag), 0));
            d.monitor.stop();
        }

        expect(Math.min(...recorded)).toBeGreaterThan(100 - 5.7 - 1);
        expect(Math.max(...recorded)).toBeLessThan(100 + 1);
    });
});

describe("DriftLag probe rules", () => {
    it("starts no probe during the 11 warm-up steps after a restart", () => {
        // Each message waits 3 ms, thus no check confirms a value, and each window asks for a probe
        const d = createDriftLag(11);
        d.thread.messageDelayMs = 3;
        d.thread.advance(3_000);
        d.thread.post(() => d.monitor.stop());
        d.thread.advance(500);
        d.thread.post(() => d.monitor.start());
        const posted = d.thread.postedMessages;
        // The message of start() waits 3 ms. A window of 6 steps of 16 ms ends during the warm-up.
        d.thread.advance(3 + 11 * 16 - 1);
        expect(d.thread.postedMessages).toBe(posted);

        // The 11th step ends the warm-up, and the probe starts
        d.thread.advance(2);
        expect(d.thread.postedMessages).toBeGreaterThan(posted);
        d.monitor.stop();
    });

    it("probes the step after the 5th step of a row of longer steps", () => {
        const d = createDriftLag(1);
        d.thread.advance(3_000);
        const posted = d.thread.postedMessages;
        const change = d.thread.now;
        d.thread.timerExtraMs = 11;
        // The step that started before the change ends in 6 ms or less. Then the steps take 16 ms.
        d.thread.advance(80);
        expect(d.thread.postedMessages).toBe(posted);
        d.thread.runUntil(change + 6 + 5 * 16 + 4);
        expect(d.thread.postedMessages).toBeGreaterThan(posted);
        d.monitor.stop();
    });

    it("does not use the probe of an earlier row for a new row", () => {
        const d = createDriftLag(1);
        d.thread.advance(3_000);
        // 8 steps of 16 ms: a probe of the 6th step shows an idle thread, but the row is not complete
        d.thread.timerExtraMs = 11;
        d.thread.advance(6 + 8 * 16 + 2);
        // Then tasks of 20 ms give steps of 20 ms: a new row, on a busy thread
        const start = d.thread.now;
        d.thread.load(20, start + 3_000);
        d.thread.advance(2_000);

        expect(d.monitor.getBaselineMs()).toBeLessThan(10);
        expect(lagFraction(d.windows, start + 1_000, start + 2_000)).toBeGreaterThan(0.5);
        d.monitor.stop();
    });

    it("ends the row when it accepts a new granularity: the next windows have their normal length", () => {
        const d = createDriftLag(1);
        d.thread.advance(3_000);
        const change = d.thread.now;
        d.thread.timerExtraMs = 11;
        d.thread.advance(2_000);

        // round(100 / 16) = 6 steps of 16 ms
        const after = d.windows.filter(w => w.endAt > change + 1_000);
        expect(after.length).toBeGreaterThan(5);
        expect(Math.max(...after.map(w => w.windowMs))).toBeLessThan(6 * 16 + 1);
        d.monitor.stop();
    });

    it("lowers the confirmed value with the baseline: a later small increase needs a probe", () => {
        const d = createDriftLag(11);
        d.thread.advance(3_000);
        // 16 ms to 14 ms: less than the jitter limit, thus no row. The baseline follows the median.
        d.thread.timerExtraMs = 9;
        d.thread.advance(3_000);
        expect(d.monitor.getBaselineMs()).toBeCloseTo(14, 1);
        const posted = d.thread.postedMessages;
        // 14 ms to 15.5 ms: more than 10% above the confirmed value of 14 ms
        d.thread.timerExtraMs = 10.5;
        d.thread.advance(3_000);

        expect(d.thread.postedMessages).toBeGreaterThan(posted);
        expect(d.monitor.getBaselineMs()).toBeCloseTo(15.5, 1);
        d.monitor.stop();
    });
});

describe("DriftLag with a probe that changes the timing", () => {
    // In Chrome, an idle step took 8 ms one time, and 5.5 ms while a probe kept the thread awake.
    // The first version used the probed step as the idle duration. Then each window had 48 ms of lag.
    it("confirms the idle duration from steps that were not probed, when a probe makes a step shorter", () => {
        const d = createDriftLag(1);
        d.thread.idleTimerWakeMs = 2;
        d.thread.advance(3_000);

        expect(d.monitor.getBaselineMs()).toBeCloseTo(8, 1);
        expect(maxLag(d.windows, 1_000)).toBeLessThan(1);
        d.monitor.stop();
    });

    // In Chromium, the step after a probe took 11 ms instead of 8 ms. Then the 3 steps of each check
    // did not agree, no check confirmed the new idle duration, and each window had 27 ms of lag.
    it("confirms a new idle duration also when the step after a probe is longer", () => {
        const d = createDriftLag(1);
        d.thread.advance(2_000);
        expect(d.monitor.getBaselineMs()).toBeCloseTo(6, 1);
        // The idle steps take 8 ms, a probed step 6 ms, and the step after a probe 11 ms
        d.thread.idleTimerWakeMs = 2;
        d.thread.lateWakeAfterAwakeMs = 3;
        d.thread.advance(3_000);

        expect(d.monitor.getBaselineMs()).toBeCloseTo(8, 1);
        expect(maxLag(d.windows, d.thread.now - 1_000)).toBeLessThan(1);
        d.monitor.stop();
    });

    // In the WebKit build of Playwright for Windows, a message waits also on an idle thread
    it("operates as without a probe when each message waits", () => {
        const d = createDriftLag(1);
        d.thread.messageDelayMs = 3;
        d.thread.advance(3_000);
        // Two increases of the granularity: rows of 10 steps are new granularities without a probe,
        // because no check confirmed a value
        for (const [extraMs, stepMs] of [[11, 16], [26, 31]] as const) {
            const change = d.thread.now;
            d.thread.timerExtraMs = extraMs;
            d.thread.advance(3_000);
            expect(d.monitor.getBaselineMs()).toBeCloseTo(stepMs, 1);
            expect(maxLag(d.windows, change)).toBeLessThan(1);
        }
        // Each window asks for one probe of one step. A message waits 3 ms, thus a probe of a step of 31 ms
        // or less posts 11 messages or less. A probe of each step would post up to 17 times more.
        expect(d.thread.postedMessages).toBeLessThan(12 * d.windows.length);
        d.monitor.stop();
    });
});

describe("DriftLag without a probe", () => {
    it("has no confirmed value: after a row of shorter steps, the baseline follows a small increase", () => {
        const d = createDriftLag(11, false);
        d.thread.advance(3_000);
        d.thread.timerExtraMs = 1;
        d.thread.advance(1_000);
        expect(d.monitor.getBaselineMs()).toBeCloseTo(6, 1);
        // 6 ms to 9 ms: no row. The baseline follows the median.
        d.thread.timerExtraMs = 4;
        d.thread.advance(3_000);

        expect(d.monitor.getBaselineMs()).toBeCloseTo(9, 1);
        d.monitor.stop();
    });

    it("operates with the default options", () => {
        const thread = new SimulatedThread(1 / 64);
        thread.timerExtraMs = 1;
        const lags : number[] = [];
        const monitor = new DriftLag(
            highFrequencyLagIntervalMs,
            (lag) => lags.push(lag),
            { log : () => {} },
            thread.setInterval,
            thread.clearInterval,
            thread.setTimeout,
            thread.clearTimeout,
            thread.clock,
        );
        thread.advance(1_000);

        expect(monitor.getBaselineMs()).toBe(6);
        expect(lags.length).toBeGreaterThan(5);
        expect(thread.postedMessages).toBe(0);
        monitor.stop();
    });

    it("clears the timer one time when it stops two times", () => {
        const thread = new SimulatedThread(1 / 64);
        const clearTimeout = vi.fn(thread.clearTimeout);
        const monitor = new DriftLag(
            highFrequencyLagIntervalMs,
            () => {},
            { log : () => {} },
            thread.setInterval,
            thread.clearInterval,
            thread.setTimeout,
            clearTimeout,
            thread.clock,
            { postTask : thread.post },
        );
        thread.advance(50);
        monitor.stop();
        monitor.stop();

        expect(clearTimeout).toHaveBeenCalledTimes(1);
    });
});
