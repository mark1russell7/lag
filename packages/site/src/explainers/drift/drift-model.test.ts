import { describe, expect, it } from "vitest";
import { baselineOf, jitterOf, simulateDrift, type DriftScenario } from "./drift-model";

const IDLE : DriftScenario = {
    granularityMs : 5,
    stepMs : 5,
    windowMs : 100,
    windows : 3,
    block : undefined,
    calibrated : true,
    jitterMs : 0,
};

describe("simulateDrift", () => {
    it("gives no lag on an idle thread with a calibrated baseline", () => {
        const result = simulateDrift(IDLE);
        expect(result.stepsPerWindow).toBe(20);
        expect(result.windows.map(window => window.lagMs)).toEqual([0, 0, 0]);
        expect(result.windows.map(window => window.end)).toEqual([100, 200, 300]);
        expect(result.steps).toHaveLength(60);
        expect(result.steps.every(step => !step.delayed)).toBe(true);
    });

    it("gives false lag without calibration when the steps are longer than the request", () => {
        const result = simulateDrift({ ...IDLE, granularityMs : 15.6, calibrated : false });
        expect(result.baselineMs).toBe(5);
        expect(result.stepsPerWindow).toBe(20);
        expect(result.windows[0]!.lagMs).toBeCloseTo(20 * 15.6 - 100, 9);
    });

    it("uses fewer and longer steps with a calibrated baseline of 15.6 ms, and gives no lag", () => {
        const result = simulateDrift({ ...IDLE, granularityMs : 15.6 });
        expect(result.baselineMs).toBeCloseTo(15.6, 9);
        expect(result.stepsPerWindow).toBe(6);
        for (const window of result.windows) expect(window.lagMs).toBeCloseTo(0, 9);
    });

    it("delays the step whose timer comes during the block until the end of the block", () => {
        // Step 2 starts at 10 ms and is due at 15 ms, in the block from 12 ms to 62 ms
        const result = simulateDrift({ ...IDLE, block : { start : 12, duration : 50 } });
        expect(result.steps[2]).toEqual({ start : 10, end : 62, delayed : true });
        expect(result.steps.filter(step => step.delayed)).toHaveLength(1);
        const [first, second] = result.windows;
        expect(first!.blockedMs).toBe(50);
        // The lag is less than the block by the time from the start of the block to the due time: 15 − 12 = 3 ms
        expect(first!.lagMs).toBeCloseTo(47, 9);
        expect(second!.lagMs).toBeCloseTo(0, 9);
        expect(second!.start).toBeCloseTo(147, 9);
    });

    it("gives a lag between the block minus one step and the block, for each start of the block", () => {
        const granularityMs = 15.6;
        for (let start = 0; start < 200; start += 3.7) {
            const result = simulateDrift({ ...IDLE, granularityMs, block : { start, duration : 120 } });
            const lag = result.windows.reduce((sum, window) => sum + window.lagMs, 0);
            expect(lag).toBeLessThanOrEqual(120 + 1e-9);
            expect(lag).toBeGreaterThan(120 - granularityMs);
        }
    });

    it("puts the lag into the window in which the delayed step ends", () => {
        const result = simulateDrift({ ...IDLE, block : { start : 95, duration : 30 } });
        // Step 19 is due at 100 ms, in the block: the first window ends at 125 ms
        expect(result.windows[0]!.end).toBe(125);
        expect(result.windows[0]!.lagMs).toBeCloseTo(25, 9);
        expect(result.windows[0]!.blockedMs).toBe(30);
        expect(result.windows[1]!.lagMs).toBeCloseTo(0, 9);
    });

    it("ignores a block of 0 ms and a block that starts after the windows", () => {
        expect(simulateDrift({ ...IDLE, block : { start : 50, duration : 0 } }).windows.map(window => window.lagMs)).toEqual([0, 0, 0]);
        expect(simulateDrift({ ...IDLE, block : { start : 400, duration : 50 } }).windows.map(window => window.lagMs)).toEqual([0, 0, 0]);
    });
});

describe("baselineOf", () => {
    it("is the mean of the idle steps, near the granularity", () => {
        const baseline = baselineOf({ ...IDLE, granularityMs : 5.7, jitterMs : 0.4 });
        expect(Math.abs(baseline - 5.7)).toBeLessThan(0.4);
        expect(baseline).not.toBe(5.7);
    });

    it("is the requested delay without calibration", () => {
        expect(baselineOf({ ...IDLE, granularityMs : 30, calibrated : false })).toBe(5);
    });
});

describe("jitterOf", () => {
    it("gives the same value for the same step, from −1 to 1", () => {
        for (let step = 0; step < 500; step++) {
            expect(jitterOf(step)).toBe(jitterOf(step));
            expect(Math.abs(jitterOf(step))).toBeLessThanOrEqual(1);
        }
    });
});
