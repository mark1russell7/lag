import { describe, expect, it } from "vitest";
import { highFrequencyLagIntervalMs } from "./constants.js";
import { DriftLag } from "./DriftLag.js";
import { SimulatedThread } from "./test-thread.js";

type Window = { endAt : number; lag : number };

/**
 * DriftLag with the timer alignment of WebKit. WebKit aligns each one-shot
 * timer of the nesting level 10 or more to the next boundary of an
 * interval: 4 ms normally, and 30 ms in Low Power Mode or with thermal
 * mitigation (`DOMTimer.cpp`, `Document::domTimerAlignmentInterval`,
 * `Page::updateDOMTimerAlignmentInterval`). The chain of 5 ms steps of
 * DriftLag is such a chain of nested timers. A
 * GitHub macOS runner cannot turn on Low Power Mode ("LowPowerMode not
 * supported on AC Power"), thus these tests use the rule of the source.
 */
function createDriftLag(alignmentMs : number, alignmentOffset : number) {
    const thread = new SimulatedThread(1 / 64);
    thread.nestedTimerAlignmentMs = alignmentMs;
    thread.alignmentOffset = alignmentOffset;
    const windows : Window[] = [];
    const monitor = new DriftLag(
        highFrequencyLagIntervalMs,
        (lag) => windows.push({ endAt : thread.now, lag }),
        { log : () => {} },
        thread.setInterval,
        thread.clearInterval,
        thread.setTimeout,
        thread.clearTimeout,
        thread.clock,
        { postTask : thread.post },
    );
    return { thread, monitor, windows };
}

const lagsBetween = (windows : readonly Window[], from : number, to : number) : number[] =>
    windows.filter(w => w.endAt >= from && w.endAt < to).map(w => w.lag);

const median = (values : readonly number[]) : number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/** The change times of the grid: 120 times, 0.5 ms apart, after 3 s on an idle thread. */
const CHANGE_OFFSETS = Array.from({ length : 120 }, (_, i) => i / 2);

describe("DriftLag with the timer alignment of WebKit", () => {
    for (const offset of [0, 0.37, 0.9]) {
        it(`gives steps of 8 ms with the normal alignment of 4 ms (offset ${offset})`, () => {
            const d = createDriftLag(4, offset);
            d.thread.advance(3_000);
            // The CI job measured a baseline of 8.4 ms in Safari 26.6.2
            expect(d.monitor.getBaselineMs()).toBeCloseTo(8, 0);
            expect(Math.max(...lagsBetween(d.windows, 1_000, 3_000).map(Math.abs))).toBeLessThan(2);
            d.monitor.stop();
        });

        it(`follows the alignment of 30 ms of Low Power Mode, and still measures a block (offset ${offset})`, () => {
            const d = createDriftLag(30, offset);
            d.thread.advance(3_000);
            expect(d.monitor.getBaselineMs()).toBeCloseTo(30, 0);
            expect(Math.abs(median(lagsBetween(d.windows, 1_500, 3_000)))).toBeLessThan(2);

            // A block of 300 ms in a task: the next step comes at the first boundary after the block
            d.thread.post(() => d.thread.busy(300));
            d.thread.advance(1_000);
            const largest = Math.max(...lagsBetween(d.windows, 3_000, 4_000));
            expect(largest).toBeGreaterThan(300 - 30 - 10);
            expect(largest).toBeLessThan(300 + 30);
            expect(Math.abs(median(lagsBetween(d.windows, 3_500, 4_000)))).toBeLessThan(2);
            d.monitor.stop();
        });

        for (const [alignmentMs, baselineMs] of [[4, 8], [30, 30]] as const) {
            // The 11th step after a start goes from a time that is not aligned to the next boundary.
            // Thus it can take 5 ms plus the grid, and give that time minus the baseline as lag.
            const startLimitMs = 5 + alignmentMs - baselineMs + 0.5;

            // A restart in a task gives 10 steps of 5 ms that WebKit does not align. These steps were
            // recent steps. After a restart on the grid of 4 ms, five windows had 4 ms of lag each.
            it(`gives no lag after a restart in a task, with a grid of ${alignmentMs} ms (offset ${offset})`, () => {
                const d = createDriftLag(alignmentMs, offset);
                d.thread.advance(3_000);
                d.thread.post(() => d.monitor.stop());
                d.thread.advance(500);
                const restart = d.thread.now;
                d.thread.post(() => d.monitor.start());
                d.thread.advance(3_000);

                expect(Math.max(...lagsBetween(d.windows, restart, Infinity))).toBeLessThan(startLimitMs);
                expect(d.monitor.getBaselineMs()).toBeCloseTo(baselineMs, 0);
                d.monitor.stop();
            });

            // On the grid of 30 ms, each step of 5 ms after a restart subtracted a baseline of 30 ms. Thus
            // only 25 ms of the block showed. Then the steps of 5 ms decreased the baseline, and 22 windows
            // had approximately 9 ms of lag each.
            it(`measures a block during the warm-up after a restart, with a grid of ${alignmentMs} ms (offset ${offset})`, () => {
                const d = createDriftLag(alignmentMs, offset);
                d.thread.advance(3_000);
                d.thread.post(() => d.monitor.stop());
                d.thread.advance(500);
                const restart = d.thread.now;
                d.thread.post(() => d.monitor.start());
                d.thread.advance(20);
                d.thread.post(() => d.thread.busy(150));
                d.thread.advance(3_000);

                const lags = lagsBetween(d.windows, restart, Infinity);
                const largest = Math.max(...lags);
                // A warm-up step gives its duration minus the baseline
                expect(largest).toBeGreaterThan(150 - baselineMs - 1);
                expect(largest).toBeLessThan(150 + 1);
                const others = lags.filter(lag => lag !== largest).reduce((sum, lag) => sum + Math.max(0, lag), 0);
                expect(others).toBeLessThan(startLimitMs);
                d.monitor.stop();
            });
        }

        // This test found a library bug. A window with the accepted row of 8 ms steps used the new
        // baseline also for its steps of 30 ms before the row: up to 44 ms of lag on an idle thread.
        it(`gives no lag when the grid changes out of Low Power Mode at any time in a window (offset ${offset})`, () => {
            let largest = -Infinity;
            for (const changeMs of CHANGE_OFFSETS) {
                const d = createDriftLag(30, offset);
                d.thread.advance(3_000 + changeMs);
                const change = d.thread.now;
                d.thread.nestedTimerAlignmentMs = 4;
                d.thread.advance(2_000);
                largest = Math.max(largest, ...lagsBetween(d.windows, change, Infinity));
                d.monitor.stop();
            }

            expect(largest).toBeLessThan(2);
        });

        // The step in which the grid changes from 4 ms to 30 ms can take between 8 ms and 35 ms. A step
        // of 12 ms to 24 ms does not agree with the old baseline or with the row of 30 ms steps. With the
        // old baseline for that step, a window had up to 15.6 ms of lag. A step of not more than 12 ms is
        // in the jitter limit of 4 ms, and it can give up to 4 ms of lag.
        it(`gives not more than the jitter limit of lag when the grid changes into Low Power Mode at any time in a window (offset ${offset})`, () => {
            let largest = -Infinity;
            for (const changeMs of CHANGE_OFFSETS) {
                const d = createDriftLag(4, offset);
                d.thread.advance(3_000 + changeMs);
                const change = d.thread.now;
                d.thread.nestedTimerAlignmentMs = 30;
                d.thread.advance(3_000);
                largest = Math.max(largest, ...lagsBetween(d.windows, change, Infinity));
                d.monitor.stop();
            }

            expect(largest).toBeLessThan(4 + 0.5);
        });
    }

    it("follows a change into Low Power Mode and out of it", () => {
        const d = createDriftLag(4, 0.37);
        d.thread.advance(3_000);
        d.thread.nestedTimerAlignmentMs = 30;
        d.thread.advance(3_000);
        expect(d.monitor.getBaselineMs()).toBeCloseTo(30, 0);
        expect(Math.abs(median(lagsBetween(d.windows, 4_500, 6_000)))).toBeLessThan(2);
        d.thread.nestedTimerAlignmentMs = 4;
        d.thread.advance(3_000);
        expect(d.monitor.getBaselineMs()).toBeCloseTo(8, 0);
        expect(Math.abs(median(lagsBetween(d.windows, 7_500, 9_000)))).toBeLessThan(2);
        d.monitor.stop();
    });
});
