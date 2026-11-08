import { quantileSorted } from "@mark1russell7/rigor-statistics";
import { describe, expect, it } from "vitest";
import { percentile, sortedValues } from "./stats";

/**
 * The copy of the site before the move to rigor-statistics, word for word. It gives the
 * nearest-rank percentile of sorted values: the smallest value that has
 * at least `p` percent of the values at or below it.
 */
function copyPercentile(sorted : readonly number[], p : number) : number | undefined {
    if (sorted.length === 0) return undefined;
    if (p <= 0) return sorted[0];
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

describe("percentile on quantileSorted of rigor-statistics and the copy of the site", () => {
    it("gives the value of the copy for each list and each p from 0 to 100", () => {
        // a seeded linear congruential generator gives the same lists in each run
        let seed = 7;
        const next = () : number => {
            seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
            return seed / 2_147_483_648;
        };
        const ps : number[] = [50, 95, 99, 99.9, 1e-9, 100 - 1e-9];
        for (let p = 0; p <= 100; p += 0.5) ps.push(p);
        let cases = 0;
        for (let n = 1; n <= 300; n++) {
            const sorted = sortedValues(Array.from({ length : n }, () => Math.round(next() * 100_000) / 100));
            for (const p of ps) {
                expect(percentile(sorted, p), `n ${n}, p ${p}`).toBe(copyPercentile(sorted, p));
                cases++;
            }
        }
        expect(cases).toBe(300 * ps.length);
    });

    it("gives undefined for no values, as the copy did, where the home throws", () => {
        expect(copyPercentile([], 95)).toBeUndefined();
        expect(percentile([], 95)).toBeUndefined();
        expect(() => quantileSorted([], 0.95, "nearest-rank")).toThrow(RangeError);
    });

    it("throws for a p outside 0 to 100, where the copy gave the lowest or the highest value", () => {
        // the site asks only for the 50th, the 95th and the 99th percentile
        expect(copyPercentile([1, 2, 3], -5)).toBe(1);
        expect(copyPercentile([1, 2, 3], 150)).toBe(3);
        expect(() => percentile([1, 2, 3], -5)).toThrow(RangeError);
        expect(() => percentile([1, 2, 3], 150)).toThrow(RangeError);
    });
});
