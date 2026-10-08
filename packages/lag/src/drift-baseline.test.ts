import { describe, expect, it } from "vitest";
import { idleStepMs, interpretCheck, isIdleStep, spreadMs, stepsUpTo, usedBaselineMs } from "./drift-baseline.js";

describe("idleStepMs", () => {
    it("is the step when there is one step", () => {
        expect(idleStepMs([7])).toBe(7);
    });

    it("leaves out a block that is longer than the median plus half the median", () => {
        // The median is 27.5 ms, thus the limit is 27.5 + 13.75 = 41.25 ms
        expect(idleStepMs([50, 5])).toBe(5);
    });
});

describe("stepsUpTo", () => {
    it("keeps the steps that are not longer than the limit, in the same sequence", () => {
        expect(stepsUpTo([9, 20, 8, 8.2, 8.3], 8.2)).toEqual([8, 8.2]);
        expect(stepsUpTo([20], 8)).toEqual([]);
    });
});

describe("spreadMs", () => {
    it("is 2 ms, or 20% of the step if that is more", () => {
        expect(spreadMs(5)).toBe(2);
        expect(spreadMs(10)).toBe(2);
        expect(spreadMs(20)).toBe(4);
    });
});

describe("usedBaselineMs", () => {
    it("is the recent baseline without a confirmed value", () => {
        expect(usedBaselineMs(50, undefined)).toBe(50);
    });

    it("is the recent baseline if it is not more than 1 ms above a confirmed value of less than 10 ms", () => {
        expect(usedBaselineMs(7, 6)).toBe(7);
        expect(usedBaselineMs(7.01, 6)).toBe(6);
        expect(usedBaselineMs(5, 6)).toBe(5);
    });

    it("permits an increase of 10% above a confirmed value of more than 10 ms", () => {
        expect(usedBaselineMs(22, 20)).toBe(22);
        expect(usedBaselineMs(22.01, 20)).toBe(20);
    });
});

describe("isIdleStep", () => {
    it("is true for a busy time of less than 2 ms when the step is not longer than the baseline", () => {
        expect(isIdleStep(6, 6, 1.99)).toBe(true);
        expect(isIdleStep(6, 6, 2)).toBe(false);
    });

    it("is true for a busy time of less than half of the extra duration of the step", () => {
        // The step is 10 ms longer than the baseline: the limit is 5 ms
        expect(isIdleStep(16, 6, 4.99)).toBe(true);
        expect(isIdleStep(16, 6, 5)).toBe(false);
    });
});

describe("interpretCheck", () => {
    it("gives no finding when the steps do not agree with each other", () => {
        // The spread of the longest step (9 ms) is 2 ms
        expect(interpretCheck([6, 9, 6], 7, undefined)).toBeUndefined();
        expect(interpretCheck([6, 8, 6], 7, undefined)).toEqual({ confirmedMs : 7 });
        // The spread of 24.5 ms is 4.9 ms
        expect(interpretCheck([20, 24.5], 22, undefined)).toEqual({ confirmedMs : 22 });
    });

    it("confirms the recent baseline as the first value", () => {
        expect(interpretCheck([6.5, 6.5, 6.5], 6, undefined)).toEqual({ confirmedMs : 6 });
        expect(interpretCheck([5, 7, 6], 20, undefined)).toEqual({ confirmedMs : 20 });
    });

    it("confirms the lower of the recent baseline and the idle duration when the idle duration agrees better with the recent baseline", () => {
        // The mean of the steps, because the recent baseline is longer
        expect(interpretCheck([9, 8, 10], 9.5, 6)).toEqual({ confirmedMs : 9 });
        expect(interpretCheck([9, 9, 9], 8.5, 6)).toEqual({ confirmedMs : 8.5 });
    });

    it("gives the limit of the load when the idle duration agrees better with the confirmed value", () => {
        // The limit is max(6 + 2, 6.2 + 2) = 8.2 ms
        expect(interpretCheck([6.2, 6.2, 6.2], 16.5, 6)).toEqual({ loadAboveMs : 8.2 });
    });

    it("gives the limit of the load when the idle duration is as near to the confirmed value as to the recent baseline", () => {
        // 8 ms is 2 ms from the two values. The limit is max(6 + 2, 8 + 2) = 10 ms.
        expect(interpretCheck([8, 8, 8], 10, 6)).toEqual({ loadAboveMs : 10 });
    });

    it("uses the larger limit: the confirmed value plus its spread, or the idle duration plus its spread", () => {
        // 20 + 4 = 24 ms and 19 + 3.8 = 22.8 ms
        expect(interpretCheck([19, 19, 19], 22.5, 20)).toEqual({ loadAboveMs : 24 });
        // 6 + 2 = 8 ms and 7 + 2 = 9 ms
        expect(interpretCheck([7, 7, 7], 8.5, 6)).toEqual({ loadAboveMs : 9 });
    });
});
