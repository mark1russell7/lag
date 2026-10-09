import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { driftStepMs, highFrequencyLagIntervalMs } from "./constants.js";
import { DriftLag, type DriftLagOptions } from "./DriftLag.js";

/**
 * DriftLag on Vitest's fake timers. Each timer fires `granularityMs` after
 * its requested delay, as a coarse system timer does. `block(ms)` makes the
 * next timer fire `ms` late, as a busy main thread does.
 */
function createDriftLag(options : { granularityMs? : number; intervalMs? : number } & DriftLagOptions = {}) {
    let extraForNext = 0;
    const report = vi.fn<(lag : number) => void>();
    const logger = { log : vi.fn() };
    const delays : number[] = [];
    const setTimeoutFn = (fn : () => void, ms : number) : number => {
        delays.push(ms);
        const extra = (options.granularityMs ?? 0) + extraForNext;
        extraForNext = 0;
        return setTimeout(fn, ms + extra) as unknown as number;
    };
    const monitor = new DriftLag(
        options.intervalMs ?? highFrequencyLagIntervalMs,
        report,
        logger,
        (fn, ms) => setInterval(fn, ms) as unknown as number,
        (id) => clearInterval(id),
        setTimeoutFn,
        (id) => clearTimeout(id),
        { now : () => Date.now() },
        {
            ...(options.stepMs !== undefined ? { stepMs : options.stepMs } : {}),
            ...(options.baselineSteps !== undefined ? { baselineSteps : options.baselineSteps } : {}),
        },
    );
    return {
        monitor,
        report,
        logger,
        delays,
        block(ms : number) { extraForNext += ms; },
        reported() { return report.mock.calls.map(c => Math.round(c[0] * 1000) / 1000); },
    };
}

describe("DriftLag", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
    });

    afterEach(() => vi.useRealTimers());

    it("reports no lag on an idle thread with exact timers", () => {
        const d = createDriftLag();
        vi.advanceTimersByTime(300);

        expect(d.reported()).toEqual([0, 0, 0]);
        expect(d.monitor.getBaselineMs()).toBe(driftStepMs);
    });

    it("subtracts the timer granularity: an idle thread with 16 ms steps has no lag", () => {
        // Firefox and WebKit on Windows: a 5 ms timer fires after one 15.6 ms tick
        const d = createDriftLag({ granularityMs : 11 });
        vi.advanceTimersByTime(2_000);

        expect(d.monitor.getBaselineMs()).toBe(16);
        expect(d.reported().length).toBeGreaterThan(5);
        expect(d.reported().every(lag => lag === 0)).toBe(true);
    });

    it("changes the number of steps so that a window stays near the expected length", () => {
        const d = createDriftLag({ granularityMs : 11 });
        // The first window: 21 steps of 16 ms. After the 11 warm-up steps, the window waits for the
        // row of 10 steps that changes the baseline from 5 ms to 16 ms. Then round(100 / 16) = 6 steps of 16 ms.
        vi.advanceTimersByTime(20 * 16);
        expect(d.report).not.toHaveBeenCalled();
        vi.advanceTimersByTime(16);
        expect(d.report).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(6 * 16);
        expect(d.report).toHaveBeenCalledTimes(2);
        vi.advanceTimersByTime(6 * 16);
        expect(d.report).toHaveBeenCalledTimes(3);
    });

    it("reports the length of a block in the window", () => {
        const d = createDriftLag();
        vi.advanceTimersByTime(100);
        d.block(300);
        vi.advanceTimersByTime(400);

        expect(d.reported()[1]).toBe(300);
    });

    it("keeps the baseline when one step is long", () => {
        const d = createDriftLag({ granularityMs : 3 });
        vi.advanceTimersByTime(800);
        d.block(500);
        vi.advanceTimersByTime(800);

        expect(d.monitor.getBaselineMs()).toBe(8);
        expect(Math.max(...d.reported())).toBe(500);
    });

    it("uses the requested step as the baseline before the first step", () => {
        const d = createDriftLag({ stepMs : 8 });
        expect(d.monitor.getBaselineMs()).toBe(8);
        expect(d.delays).toEqual([8]);
    });

    it("requests the same step delay for every step, with or without lag", () => {
        const d = createDriftLag();
        vi.advanceTimersByTime(100);
        d.block(40);
        vi.advanceTimersByTime(300);

        expect(new Set(d.delays)).toEqual(new Set([driftStepMs]));
    });

    it("logs errors and continues monitoring when report throws", () => {
        const d = createDriftLag();
        d.report.mockImplementationOnce(() => { throw new Error("first"); });
        vi.advanceTimersByTime(200);

        expect(d.logger.log).toHaveBeenCalledWith("error", "Error measuring/reporting lag.",
            expect.objectContaining({ type : "LagMonitor", subtype : "DriftLag" }));
        expect(d.report).toHaveBeenCalledTimes(2);
    });

    it("stop() right after construction clears the pending timer", () => {
        const d = createDriftLag();
        d.monitor.stop();
        expect(vi.getTimerCount()).toBe(0);
        vi.advanceTimersByTime(300);
        expect(d.report).not.toHaveBeenCalled();
    });

    it("stop() from inside report stops the loop", () => {
        const d = createDriftLag();
        d.report.mockImplementation(() => d.monitor.stop());
        vi.advanceTimersByTime(300);

        expect(d.report).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("start() after stop() measures from the restart, not across the stopped time", () => {
        const d = createDriftLag();
        vi.advanceTimersByTime(100);
        d.monitor.stop();
        vi.setSystemTime(Date.now() + 60_000);
        d.monitor.start();
        vi.advanceTimersByTime(100);

        expect(d.reported()).toEqual([0, 0]);
    });

    it("start() while running does not add a second timer chain", () => {
        const d = createDriftLag();
        d.monitor.start();
        expect(vi.getTimerCount()).toBe(1);
    });

    it("stop() + start() from inside report leaves exactly one timer chain", () => {
        const d = createDriftLag();
        d.report.mockImplementationOnce(() => { d.monitor.stop(); d.monitor.start(); });
        vi.advanceTimersByTime(100);
        expect(vi.getTimerCount()).toBe(1);

        d.monitor.stop();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("uses whole steps for a window: 103 ms gives 20 steps of 5 ms", () => {
        const d = createDriftLag({ intervalMs : 103 });
        vi.advanceTimersByTime(99);
        expect(d.report).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(d.reported()).toEqual([0]);
    });
});
