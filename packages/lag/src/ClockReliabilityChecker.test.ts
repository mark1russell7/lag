import { expect } from "vitest";
import { ClockReliabilityChecker } from "./ClockReliabilityChecker.js";

describe("ClockReliabilityChecker", () => {
    it("detects clock resolution from rapid samples", () => {
        let tick = 0;
        const performance = {
            now : () => { tick += 0.1; return tick; },  // 100μs resolution
            timeOrigin : 0,
        };

        const checker = new ClockReliabilityChecker(performance);
        const resolution = checker.getResolutionMs();

        expect(resolution).toBeCloseTo(0.1, 5);
    });

    it("reports cross-origin isolated when resolution <= 5μs", () => {
        let tick = 0;
        const performance = {
            now : () => { tick += 0.001; return tick; },  // 1μs resolution
            timeOrigin : 0,
        };

        const checker = new ClockReliabilityChecker(performance);
        expect(checker.isCrossOriginIsolated()).toBe(true);
    });

    it("reports not cross-origin isolated when resolution > 5μs", () => {
        let tick = 0;
        const performance = {
            now : () => { tick += 0.1; return tick; },  // 100μs resolution
            timeOrigin : 0,
        };

        const checker = new ClockReliabilityChecker(performance);
        expect(checker.isCrossOriginIsolated()).toBe(false);
    });

    it("exposes the time origin from performance", () => {
        const checker = new ClockReliabilityChecker({
            now : () => 0,
            timeOrigin : 1234567890,
        });
        expect(checker.getTimeOrigin()).toBe(1234567890);
    });

    it("handles zero-delta clock (all identical readings)", () => {
        const performance = {
            now : () => 42, // always returns same value
            timeOrigin : 0,
        };

        const checker = new ClockReliabilityChecker(performance);
        expect(checker.getResolutionMs()).toBe(0);
    });
});
