import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { highFrequencyLagIntervalMs } from "./constants.js";
import { DriftLag, type DriftLagOptions } from "./DriftLag.js";

/**
 * The timer granularity of a page can change while DriftLag operates. On
 * Windows, Chromium gets a timer resolution of 1 ms. Windows can change the
 * process to the default tick of 15.6 ms. Examples are battery power (8 ms)
 * and a window that is occluded or minimized. The cdp project also measured
 * the change after a headless page was hidden and shown again. A 5 ms step
 * then takes approximately 16 ms instead of approximately 6 ms on an idle
 * thread.
 */
function createDriftLag(initialGranularityMs = 1, options : DriftLagOptions = {}) {
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
        options,
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

describe("DriftLag baseline of a short window of steps", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
    });

    afterEach(() => vi.useRealTimers());

    it("uses the mean of the two middle steps as the median of an even number of steps", () => {
        const d = createDriftLag(0, { baselineSteps : 4 });
        d.busySteps(0, 5, 10);
        vi.advanceTimersByTime(35);

        // The steps are 5, 5, 10 and 15 ms. The median is 7.5 ms, thus the limit is 11.5 ms and 15 ms is a block.
        expect(d.monitor.getBaselineMs()).toBeCloseTo(20 / 3, 6);
        d.monitor.stop();
    });

    it("uses the middle step as the median of an odd number of steps, and keeps a step at the limit", () => {
        const d = createDriftLag(0, { baselineSteps : 3 });
        d.busySteps(5, 10);
        vi.advanceTimersByTime(30);

        // The steps are 5, 10 and 15 ms. The median is 10 ms, thus the limit is 10 + 5 = 15 ms.
        expect(d.monitor.getBaselineMs()).toBe(10);
        d.monitor.stop();
    });
});

describe("DriftLag rules for a change of the granularity", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
    });

    afterEach(() => vi.useRealTimers());

    it("accepts a new granularity after exactly 10 steps in a row", () => {
        const d = createDriftLag();
        vi.advanceTimersByTime(3_000);
        d.setGranularity(11);
        // One step of 6 ms started before the change. Then 10 steps of 16 ms come.
        vi.advanceTimersByTime(6 + 9 * 16);
        expect(d.monitor.getBaselineMs()).toBe(6);

        vi.advanceTimersByTime(16);
        expect(d.monitor.getBaselineMs()).toBe(16);
        d.monitor.stop();
    });

    it("starts a new row of steps after a restart", () => {
        const d = createDriftLag();
        vi.advanceTimersByTime(3_000);
        d.setGranularity(11);
        // One step of 6 ms comes first, then 5 steps of 16 ms come
        vi.advanceTimersByTime(6 + 5 * 16);
        d.monitor.stop();
        d.monitor.start();
        vi.advanceTimersByTime(5 * 16);

        // 5 + 5 steps of 16 ms are not a row of 10
        expect(d.monitor.getBaselineMs()).toBe(6);
        d.monitor.stop();
    });

    it("does not change the baseline for a row that a normal step interrupts", () => {
        const d = createDriftLag();
        vi.advanceTimersByTime(3_000);
        d.busySteps(10, 10, 10, 10, 10, 0, 10, 10, 10, 10, 10);
        vi.advanceTimersByTime(6 + 5 * 16 + 6 + 5 * 16);

        expect(d.monitor.getBaselineMs()).toBe(6);
        d.monitor.stop();
    });

    it("does not start a row with steps that are longer than the baseline by exactly the jitter limit (4 ms)", () => {
        const d = createDriftLag(0);
        vi.advanceTimersByTime(1_000);
        d.setGranularity(4);
        // One step of 5 ms comes first, then 10 steps of 9 ms come
        vi.advanceTimersByTime(5 + 10 * 9);

        // The granularity does not change. The baseline is the mean of the last 100 steps: 90 of 5 ms and 10 of 9 ms.
        expect(d.monitor.getBaselineMs()).toBeCloseTo(5.4, 6);
        d.monitor.stop();
    });

    it("accepts a row of steps of exactly 40 ms as a new granularity", () => {
        const d = createDriftLag(0);
        vi.advanceTimersByTime(1_000);
        d.setGranularity(35);
        vi.advanceTimersByTime(5 + 10 * 40);

        expect(d.monitor.getBaselineMs()).toBe(40);
        d.monitor.stop();
    });

    it("accepts a row of steps that differ by 20 % of their mean as one granularity", () => {
        const d = createDriftLag(0);
        vi.advanceTimersByTime(1_000);
        // Steps of 18 and 22 ms come one after the other. They differ by 4 ms, which is 20 % of 20 ms.
        d.busySteps(13, 17, 13, 17, 13, 17, 13, 17, 13, 17);
        vi.advanceTimersByTime(5 + 5 * 18 + 5 * 22);

        expect(d.monitor.getBaselineMs()).toBe(20);
        d.monitor.stop();
    });

    it("ends a window not more than 10 steps after its normal length while rows of steps start and end", () => {
        const d = createDriftLag(0);
        // 100 idle steps of 5 ms make 5 windows of 20 steps
        vi.advanceTimersByTime(500);
        expect(d.lags).toEqual([0, 0, 0, 0, 0]);
        // After one idle step, steps of 16 and 30 ms come one after the other. Each of these steps starts a new row.
        d.busySteps(...Array.from({ length : 40 }, (_, i) => (i % 2 === 0 ? 11 : 25)));
        vi.advanceTimersByTime(5 + 20 * 16 + 20 * 30);

        // The next window has 30 steps: the idle step, then 15 steps of 16 ms and 14 steps of 30 ms
        expect(d.lags[5]).toBe(15 * 11 + 14 * 25);
        d.monitor.stop();
    });
});
