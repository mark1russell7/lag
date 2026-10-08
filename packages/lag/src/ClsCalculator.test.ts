import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ClsCalculator } from "./ClsCalculator.js";

/**
 * This function gives the CLS of web-vitals (`LayoutShiftManager`). A shift
 * joins the session window if it is less than 1000 ms after the previous
 * shift and less than 5000 ms after the first shift. CLS is the largest
 * window sum.
 */
function referenceCls(shifts : ReadonlyArray<{ t : number; v : number }>) : number {
    let worst = 0;
    let session = 0;
    let start = -1;
    let last = -1;
    for (const { t, v } of shifts) {
        if (start < 0 || t - last >= 1_000 || t - start >= 5_000) {
            session = 0;
            start = t;
        }
        session += v;
        last = t;
        worst = Math.max(worst, session);
    }
    return worst;
}

describe("ClsCalculator boundaries", () => {
    it("starts a new window at a gap of exactly 1000 ms and at a length of exactly 5000 ms, as web-vitals does", () => {
        const gap = new ClsCalculator();
        gap.add(0, 0.1);
        gap.add(1_000, 0.1);
        expect(gap.getCLS()).toBeCloseTo(0.1);

        const length = new ClsCalculator();
        for (const t of [0, 900, 1_800, 2_700, 3_600, 4_500, 5_000]) length.add(t, 0.1);
        expect(length.getCLS()).toBeCloseTo(0.6);
    });
});

describe("ClsCalculator", () => {
    it("sums shifts in one session window", () => {
        const cls = new ClsCalculator();
        cls.add(0, 0.1);
        cls.add(500, 0.05);
        expect(cls.getCLS()).toBeCloseTo(0.15);
    });

    it("starts a new window after a gap of more than 1 s", () => {
        const cls = new ClsCalculator();
        cls.add(0, 0.1);
        cls.add(1_500, 0.05);
        expect(cls.getCLS()).toBeCloseTo(0.1);
    });

    it("starts a new window when a window is longer than 5 s", () => {
        const cls = new ClsCalculator();
        for (let t = 0; t <= 6_000; t += 900) cls.add(t, 0.01);
        // 0..4500 (6 shifts) fall in the first window
        expect(cls.getCLS()).toBeCloseTo(0.06);
    });

    it("keeps the sources of the largest shift in the worst window", () => {
        const cls = new ClsCalculator();
        cls.add(0, 0.01, ["a"]);
        cls.add(100, 0.2, ["b"]);
        cls.add(5_000, 0.05, ["c"]);
        expect(cls.getLargestShiftSources()).toEqual(["b"]);
    });

    it("counts the 5 s length of a window from its first shift, also when the first shift is late", () => {
        const late = new ClsCalculator();
        for (const t of [3_000, 3_900, 4_800, 5_700, 6_600, 7_500, 7_900]) late.add(t, 0.01);
        const early = new ClsCalculator();
        for (const t of [100, 900, 1_700, 2_500, 3_300, 4_100, 4_900, 5_050]) early.add(t, 0.01);

        // Each window takes all its shifts: the last shift is less than 5000 ms after the first one
        expect(late.getCLS()).toBeCloseTo(0.07);
        expect(early.getCLS()).toBeCloseTo(0.08);
    });

    it("starts the first window after reset() at the first shift", () => {
        const cls = new ClsCalculator();
        cls.add(0, 0.3);
        cls.reset();
        for (const t of [500, 1_400, 2_300, 3_200, 4_100, 5_000, 5_400]) cls.add(t, 0.01);

        expect(cls.getCLS()).toBeCloseTo(0.07);
    });

    it("gives no sources for a shift without sources", () => {
        const cls = new ClsCalculator();
        cls.add(0, 0.1);
        expect(cls.getLargestShiftSources()).toEqual([]);
    });

    it("keeps the largest shift of a window when a smaller shift follows", () => {
        const cls = new ClsCalculator();
        cls.add(0, 0.3, ["large"]);
        cls.add(100, 0.1, ["small"]);
        expect(cls.getLargestShiftSources()).toEqual(["large"]);
    });

    // A difference from web-vitals: for two shifts with the same score in the worst window, web-vitals
    // names the later shift (getLargestLayoutShiftEntry in attribution/onCLS.ts). The calculator keeps
    // the first shift. Only the attribution changes, not the value of CLS.
    it("names the later of two shifts with the same score in a window, as web-vitals does", () => {
        const cls = new ClsCalculator();
        cls.add(0, 0.1, ["first"]);
        cls.add(100, 0.1, ["second"]);
        expect(cls.getLargestShiftSources()).toEqual(["second"]);
    });

    it("keeps the first of two windows with the same score as the worst window, as web-vitals does", () => {
        const cls = new ClsCalculator();
        cls.add(0, 0.1, ["first"]);
        cls.add(2_000, 0.1, ["second"]);
        expect(cls.getLargestShiftSources()).toEqual(["first"]);
    });

    it("reset() clears everything", () => {
        const cls = new ClsCalculator();
        cls.add(0, 0.3, ["x"]);
        cls.reset();
        expect(cls.getCLS()).toBe(0);
        expect(cls.getLargestShiftSources()).toEqual([]);
    });

    it("agrees with the reference definition for any sequence of shifts (property test)", () => {
        fc.assert(fc.property(
            fc.array(fc.record({ dt : fc.integer({ min : 0, max : 3_000 }), v : fc.double({ min : 0, max : 0.5, noNaN : true }) }), { maxLength : 200 }),
            (steps) => {
                let t = 0;
                const shifts = steps.map(({ dt, v }) => ({ t : (t += dt), v }));
                const cls = new ClsCalculator();
                for (const { t : time, v } of shifts) cls.add(time, v);
                expect(cls.getCLS()).toBeCloseTo(referenceCls(shifts), 10);
            },
        ));
    });
});
