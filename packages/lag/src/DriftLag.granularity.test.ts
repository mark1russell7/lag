import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { highFrequencyLagIntervalMs } from "./constants.js";
import { DriftLag } from "./DriftLag.js";

/**
 * The timer granularity of a page can change while DriftLag runs. On
 * Windows, Chromium gets a 1 ms timer resolution, and Windows can drop the
 * process to the default 15.6 ms tick: on battery (8 ms), for a window that
 * is occluded or minimized, and (measured in the cdp project) after a
 * headless page was hidden and shown again. A 5 ms step then takes about
 * 16 ms instead of about 6 ms, on a thread that is idle.
 */
function createDriftLag(initialGranularityMs = 1) {
    let granularityMs = initialGranularityMs;
    /** The extra delays of the next steps, one for each step (a sequence of busy steps). */
    const nextExtras : number[] = [];
    const lags : number[] = [];
    const monitor = new DriftLag(
        highFrequencyLagIntervalMs,
        (lag) => lags.push(lag),
        { log : vi.fn() },
        (fn, ms) => setInterval(fn, ms) as unknown as number,
        (id) => clearInterval(id),
        (fn, ms) => setTimeout(fn, ms + granularityMs + (nextExtras.shift() ?? 0)) as unknown as number,
        (id) => clearTimeout(id),
        { now : () => Date.now() },
    );
    return {
        monitor,
        lags,
        setGranularity(ms : number) { granularityMs = ms; },
        /** The next steps are late by these values, one after the other. */
        busySteps(...extras : number[]) { nextExtras.push(...extras); },
    };
}

describe("DriftLag when the timer granularity changes", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
    });

    afterEach(() => vi.useRealTimers());

    // This test found a library bug. Each 16 ms step is longer than
    // 6 + 4 = 10 ms, so DriftLag counted it as a block until most of the last
    // 100 steps were 16 ms (approximately 0.8 s). In that time, each window of
    // 17 steps reported approximately 170 ms of lag on an idle thread. The cdp
    // project showed the same in Chromium: windows of 160 ms after a page was
    // shown again, with no long animation frame and no heartbeat delay.
    it("reports no lag on an idle thread after the steps change from 6 ms to 16 ms", () => {
        const d = createDriftLag();
        vi.advanceTimersByTime(3_000);
        expect(d.monitor.getBaselineMs()).toBe(6);
        d.lags.length = 0;

        d.setGranularity(11);
        vi.advanceTimersByTime(3_000);

        // Measured: 120, 170, 170, 63, 23, 17, 10, 5, then 0 ms
        expect(Math.max(...d.lags)).toBeLessThan(20);
        d.monitor.stop();
    });

    it("adapts the baseline to the new granularity in about one second", () => {
        const d = createDriftLag();
        vi.advanceTimersByTime(3_000);
        d.setGranularity(11);
        vi.advanceTimersByTime(1_500);
        d.lags.length = 0;

        vi.advanceTimersByTime(2_000);
        expect(d.monitor.getBaselineMs()).toBe(16);
        expect(d.lags.length).toBeGreaterThan(10);
        expect(d.lags.every(lag => Math.abs(lag) < 1)).toBe(true);
        d.monitor.stop();
    });

    it("gives no lag when the change comes at the end of a window: the window waits for the row", () => {
        const d = createDriftLag();
        // The first window has 20 steps; the next windows have round(100 / 6) = 17 steps
        vi.advanceTimersByTime(20 * 6 + 15 * 6);
        d.lags.length = 0;
        d.setGranularity(11);
        vi.advanceTimersByTime(2_000);

        expect(Math.max(...d.lags)).toBeLessThan(1);
        d.monitor.stop();
    });

    it("follows a change to a finer granularity, and then measures a block correctly", () => {
        const d = createDriftLag(11);
        vi.advanceTimersByTime(3_000);
        expect(d.monitor.getBaselineMs()).toBe(16);

        d.setGranularity(1);
        vi.advanceTimersByTime(1_000);
        expect(d.monitor.getBaselineMs()).toBe(6);
        d.lags.length = 0;
        d.busySteps(300);
        vi.advanceTimersByTime(1_000);

        expect(Math.max(...d.lags)).toBe(300);
        d.monitor.stop();
    });

    it("keeps a row of long steps (more than 40 ms) as lag: no granularity is that coarse", () => {
        const d = createDriftLag();
        vi.advanceTimersByTime(3_000);
        d.lags.length = 0;
        // A busy thread: 30 steps that are each 60 ms late
        d.busySteps(...Array.from({ length : 30 }, () => 60));
        vi.advanceTimersByTime(3_000);

        expect(d.monitor.getBaselineMs()).toBe(6);
        expect(d.lags.reduce((sum, lag) => sum + lag, 0)).toBeCloseTo(30 * 60, 6);
        d.monitor.stop();
    });

    it("keeps a row of steps that do not agree with each other as lag", () => {
        const d = createDriftLag();
        vi.advanceTimersByTime(3_000);
        d.lags.length = 0;
        // Irregular load: steps of 16, 30, 18 and 36 ms
        d.busySteps(...Array.from({ length : 40 }, (_, i) => [10, 24, 12, 30][i % 4]!));
        vi.advanceTimersByTime(3_000);

        expect(d.monitor.getBaselineMs()).toBe(6);
        expect(d.lags.reduce((sum, lag) => sum + lag, 0)).toBeCloseTo(10 * (10 + 24 + 12 + 30), 6);
        d.monitor.stop();
    });
});

describe("DriftLag baseline", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
    });

    afterEach(() => vi.useRealTimers());

    it("is the mean of the steps that are not longer than the median plus max(4 ms, half the median)", () => {
        const d = createDriftLag(0);
        // Steps of 5, 50 (a block), then 5, 5, 5 and 8 ms in a cycle. The median is 5 ms, thus the
        // limit is 5 + 4 = 9 ms: the 8 ms steps are jitter, and the 50 ms step is a block.
        d.busySteps(45, ...Array.from({ length : 199 }, (_, i) => (i % 4 === 3 ? 3 : 0)));
        vi.advanceTimersByTime(1_100);

        // The last 100 steps: 75 steps of 5 ms and 25 steps of 8 ms
        expect(d.monitor.getBaselineMs()).toBeCloseTo((75 * 5 + 25 * 8) / 100, 6);
        d.monitor.stop();
    });

    it("leaves out a block, also when the block comes before shorter steps", () => {
        const d = createDriftLag(0);
        d.busySteps(45, 2, 2, 2, 2);
        vi.advanceTimersByTime(75);

        // The steps are 5, 50, 7 and 7 ms (the first step starts before the extras): the
        // median is 7 ms, thus 50 ms is a block, and the shorter step before it is not
        expect(d.monitor.getBaselineMs()).toBeCloseTo((5 + 7 + 7) / 3, 6);
        d.monitor.stop();
    });
});
