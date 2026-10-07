import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { ClsCalculator } from "./ClsCalculator.js";

/** The CLS definition: the largest sum of a session window (gap ≤ 1 s, length ≤ 5 s). */
function referenceCls(shifts : ReadonlyArray<{ t : number; v : number }>) : number {
    let worst = 0;
    let session = 0;
    let start = -1;
    let last = -1;
    for (const { t, v } of shifts) {
        if (start < 0 || t - last > 1_000 || t - start > 5_000) {
            session = 0;
            start = t;
        }
        session += v;
        last = t;
        worst = Math.max(worst, session);
    }
    return worst;
}

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
