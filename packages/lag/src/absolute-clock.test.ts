import { describe, it, expect } from "vitest";
import { createAbsoluteClock } from "./absolute-clock.js";

describe("createAbsoluteClock", () => {
    it("reads timeOrigin one time, so that a later change of timeOrigin does not move the clock", () => {
        // Safari calculates timeOrigin again from the wall clock at each read
        let timeOrigin = 1_700_000_000_000;
        let now = 250;
        const performance = { get timeOrigin() { return timeOrigin; }, now : () => now };
        const clock = createAbsoluteClock(performance);

        timeOrigin += 5_000;
        now = 300;

        expect(clock.origin).toBe(1_700_000_000_000);
        expect(clock.now()).toBe(1_700_000_000_300);
        expect(clock.monotonic()).toBe(300);
    });
});
