import { describe, expect, it } from "vitest";
import { BaselineConfirmation } from "./BaselineConfirmation.js";

/** This function does a check: an idle probe, the steps, and a closing probe. It gives the result of the closing probe. */
function check(c : BaselineConfirmation, steps : number[], recentMs : number, closingIdle = true) : number | undefined {
    expect(c.addProbe(true, recentMs)).toBeUndefined();
    steps.forEach((step, i) => expect(c.addStep(step)).toBe(i === steps.length - 1));
    return c.addProbe(closingIdle, recentMs);
}

/** A confirmation with the confirmed value 6 ms. */
function confirmedAt6() : BaselineConfirmation {
    const c = new BaselineConfirmation();
    c.endWindow(6);
    check(c, [6, 6, 6], 6);
    expect(c.confirmedMs).toBe(6);
    return c;
}

describe("BaselineConfirmation", () => {
    it("needs a check from the start: a probe before the first window can start a check", () => {
        const c = new BaselineConfirmation();
        c.addProbe(true, 6);

        expect(c.addStep(6)).toBe(false);
        expect(c.addStep(6)).toBe(false);
        expect(c.addStep(6)).toBe(true);
    });

    it("has no value at first, and asks for a check at the end of the first window", () => {
        const c = new BaselineConfirmation();
        expect(c.confirmedMs).toBeUndefined();
        expect(c.endWindow(6)).toEqual({ baselineMs : 6, probe : true });
    });

    it("confirms a value with an idle probe, 3 steps and an idle closing probe", () => {
        const c = new BaselineConfirmation();
        c.endWindow(6.2);
        check(c, [6, 6, 6], 6.2);
        // The first value is the recent baseline
        expect(c.confirmedMs).toBe(6.2);
        expect(c.endWindow(6.2)).toEqual({ baselineMs : 6.2, probe : false });
    });

    it("ignores the steps that are not in a check", () => {
        const c = new BaselineConfirmation();
        expect(c.addStep(6)).toBe(false);
        expect(c.confirmedMs).toBeUndefined();
    });

    it("asks for a check at each window after a busy probe, until a check confirms a value", () => {
        const c = new BaselineConfirmation();
        for (let i = 0; i < 3; i++) {
            expect(c.endWindow(6).probe).toBe(true);
            c.addProbe(false, 6);
        }
        check(c, [6, 6, 6], 6);
        expect(c.endWindow(6).probe).toBe(false);
    });

    it("discards a check when the closing probe is busy, and asks again at the next window", () => {
        const c = new BaselineConfirmation();
        c.endWindow(6);
        check(c, [6, 6, 6], 6, false);

        expect(c.confirmedMs).toBeUndefined();
        expect(c.endWindow(6).probe).toBe(true);
    });

    it("discards a check whose steps do not agree", () => {
        const c = new BaselineConfirmation();
        c.endWindow(6);
        check(c, [6, 6, 30], 6);

        expect(c.confirmedMs).toBeUndefined();
    });

    it("asks for no probe while a check operates", () => {
        const c = new BaselineConfirmation();
        c.endWindow(6);
        c.addProbe(true, 6);

        expect(c.endWindow(6).probe).toBe(false);
    });

    it("starts a new check when a probe comes before the end of a check", () => {
        const c = new BaselineConfirmation();
        c.endWindow(6);
        c.addProbe(true, 6);
        c.addStep(6);
        c.addProbe(true, 6);

        // The check starts again: two steps do not close it
        expect(c.addStep(6)).toBe(false);
        expect(c.addStep(6)).toBe(false);
        expect(c.addStep(6)).toBe(true);
    });

    it("uses the confirmed value while the recent baseline is more than max(1 ms, 10%) above it", () => {
        const c = confirmedAt6();
        expect(c.endWindow(7)).toEqual({ baselineMs : 7, probe : false });
        expect(c.endWindow(7.01)).toEqual({ baselineMs : 6, probe : true });
    });

    it("lowers the confirmed value to the highest recent baseline of the last 3 windows", () => {
        const c = confirmedAt6();
        expect(c.endWindow(5)).toEqual({ baselineMs : 5, probe : false });
        expect(c.confirmedMs).toBe(6);
        c.endWindow(5.5);
        expect(c.confirmedMs).toBe(6);
        c.endWindow(5);
        expect(c.confirmedMs).toBe(5.5);
        c.endWindow(5);
        expect(c.confirmedMs).toBe(5.5);
        c.endWindow(5);
        expect(c.confirmedMs).toBe(5);
    });

    it("keeps the confirmed value after a short decrease of the recent baseline", () => {
        const c = confirmedAt6();
        c.endWindow(6);
        c.endWindow(4);
        c.endWindow(6);
        c.endWindow(6);
        expect(c.confirmedMs).toBe(6);
    });

    it("ignores a probe of a row when no check is necessary", () => {
        const c = confirmedAt6();
        c.endWindow(6);
        c.addProbe(false, 6);
        c.addProbe(true, 6);

        // No check started
        expect(c.addStep(6)).toBe(false);
        expect(c.endWindow(8).probe).toBe(true);
    });

    it("keeps the confirmed value when the check agrees with it, and gives the limit of the load", () => {
        const c = confirmedAt6();
        c.endWindow(20);
        expect(check(c, [6, 6, 6], 20)).toBe(8);
        expect(c.confirmedMs).toBe(6);
    });

    it("gives no limit when the closing probe is busy, or when the steps do not agree", () => {
        const c = confirmedAt6();
        c.endWindow(20);
        expect(check(c, [6, 6, 6], 20, false)).toBeUndefined();
        c.endWindow(20);
        expect(check(c, [6, 6, 30], 20)).toBeUndefined();
        expect(c.confirmedMs).toBe(6);
    });

    it("confirms a larger value when the check agrees with the recent baseline", () => {
        const c = confirmedAt6();
        c.endWindow(9);
        check(c, [9, 9, 9], 9);
        expect(c.confirmedMs).toBe(9);
    });

    it("sets a new granularity with accept(), and ends a check", () => {
        const c = confirmedAt6();
        c.endWindow(20);
        c.addProbe(true, 20);
        c.accept(16);

        expect(c.confirmedMs).toBe(16);
        expect(c.addStep(16)).toBe(false);
    });

    it("does not confirm a first value with accept(): only a check does", () => {
        const c = new BaselineConfirmation();
        c.endWindow(6);
        c.addProbe(true, 6);
        c.accept(16);

        expect(c.confirmedMs).toBeUndefined();
        expect(c.addStep(16)).toBe(false);
        expect(c.endWindow(16).probe).toBe(true);
    });
});
