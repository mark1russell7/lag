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
function createDriftLag() {
    let granularityMs = 1;
    const lags : number[] = [];
    const monitor = new DriftLag(
        highFrequencyLagIntervalMs,
        (lag) => lags.push(lag),
        { log : vi.fn() },
        (fn, ms) => setInterval(fn, ms) as unknown as number,
        (id) => clearInterval(id),
        (fn, ms) => setTimeout(fn, ms + granularityMs) as unknown as number,
        (id) => clearTimeout(id),
        { now : () => Date.now() },
    );
    return {
        monitor,
        lags,
        setGranularity(ms : number) { granularityMs = ms; },
    };
}

describe("DriftLag when the timer granularity changes", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
    });

    afterEach(() => vi.useRealTimers());

    // Library bug: the baseline is the mean of the recent steps that are not
    // longer than the median plus max(4 ms, median / 2). After the change,
    // each 16 ms step is longer than 6 + 4 = 10 ms, so DriftLag counts it as
    // a block until most of the last 100 steps are 16 ms (about 0.8 s). In
    // that time each window of about 17 steps reports about 17 * 10 = 170 ms
    // of lag on an idle thread. The cdp project showed the same in Chromium:
    // windows of 160 ms after a page was shown again, with no long animation
    // frame and no heartbeat delay. Remove `.fails` when DriftLag is fixed.
    it.fails("reports no lag on an idle thread after the steps change from 6 ms to 16 ms", () => {
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
});
