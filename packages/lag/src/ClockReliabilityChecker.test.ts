import { expect } from "vitest";
import { ClockReliabilityChecker } from "./ClockReliabilityChecker.js";

/** A clock that only advances by `resolutionMs` every `callsPerTick` reads — like a coarsened performance.now(). */
function coarseClock(resolutionMs : number, callsPerTick : number) {
    let calls = 0;
    return {
        now : () => Math.floor(calls++ / callsPerTick) * resolutionMs,
        timeOrigin : 0,
        get calls() { return calls; },
    };
}

describe("ClockReliabilityChecker", () => {
    it("detects clock resolution from rapid samples", () => {
        const checker = new ClockReliabilityChecker(coarseClock(0.1, 1));
        expect(checker.getResolutionMs()).toBeCloseTo(0.1, 5);
    });

    it("detects a coarse clock that stays flat across many consecutive reads", () => {
        // A 100μs clock read in a tight loop returns the same value thousands of times
        const checker = new ClockReliabilityChecker(coarseClock(0.1, 5_000));
        expect(checker.getResolutionMs()).toBeCloseTo(0.1, 5);
        expect(checker.isHighResolution()).toBe(false);
    });

    it("reports high resolution for a cross-origin-isolated clock (5μs)", () => {
        const checker = new ClockReliabilityChecker(coarseClock(0.005, 20));
        expect(checker.isHighResolution()).toBe(true);
    });

    it("reports low resolution for a 1ms clock", () => {
        const checker = new ClockReliabilityChecker(coarseClock(1, 10_000));
        expect(checker.isHighResolution()).toBe(false);
    });

    it("measures once and caches the result", () => {
        const clock = coarseClock(0.1, 1);
        const checker = new ClockReliabilityChecker(clock);
        checker.getResolutionMs();
        const callsAfterFirst = clock.calls;

        checker.getResolutionMs();
        checker.isHighResolution();

        expect(clock.calls).toBe(callsAfterFirst);
    });

    it("samples again after a call where the clock never ticked", () => {
        let frozen = true;
        const checker = new ClockReliabilityChecker({
            now : (() => { let t = 0; return () => (frozen ? 0 : (t += 0.1)); })(),
            timeOrigin : 0,
        });

        expect(checker.getResolutionMs()).toBe(0);
        frozen = false;
        expect(checker.getResolutionMs()).toBeCloseTo(0.1, 5);
    });

    it("exposes the time origin from performance", () => {
        const checker = new ClockReliabilityChecker({
            now : () => 0,
            timeOrigin : 1234567890,
        });
        expect(checker.getTimeOrigin()).toBe(1234567890);
    });

    it("returns 0 and is not high-resolution for a clock that never advances", () => {
        const checker = new ClockReliabilityChecker({ now : () => 42, timeOrigin : 0 });
        expect(checker.getResolutionMs()).toBe(0);
        expect(checker.isHighResolution()).toBe(false);
    });
});
