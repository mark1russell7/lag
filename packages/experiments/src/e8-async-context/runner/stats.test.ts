import { median, quantile } from "@mark1russell7/rigor-statistics";
import { describe, expect, it } from "vitest";
import { medianOrNaN, spread } from "./stats.js";
import { roundOrder } from "./plan.js";

/** The copy of the runner before the move to rigor-statistics, word for word: the reference of the move. */
function copyMedian(values : readonly number[]) : number {
    if (values.length === 0) return Number.NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

describe("medianOrNaN", () => {
    it("gives the middle value of an odd count", () => {
        expect(medianOrNaN([5, 1, 3])).toBe(3);
    });

    it("gives the mean of the two middle values of an even count", () => {
        expect(medianOrNaN([4, 1, 3, 2])).toBe(2.5);
    });

    it("gives NaN for no values, as the copy did, where the home throws", () => {
        expect(copyMedian([])).toBeNaN();
        expect(medianOrNaN([])).toBeNaN();
        expect(() => median([])).toThrow(RangeError);
    });

    it("gives NaN for a list with a NaN, where the copy gave a value that depends on the order", () => {
        expect(medianOrNaN([1, Number.NaN, 2])).toBeNaN();
        expect(() => median([1, Number.NaN, 2])).toThrow(RangeError);
    });

    it("gives the value of the copy for each list of numbers", () => {
        // a seeded linear congruential generator gives the same lists in each run
        let seed = 11;
        const next = () : number => {
            seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
            return seed / 2_147_483_648;
        };
        let cases = 0;
        for (let n = 1; n <= 300; n++) {
            const list = Array.from({ length : n }, () => Math.round(next() * 10_000) / 100 - 20);
            expect(medianOrNaN(list)).toBe(copyMedian(list));
            expect(median(list)).toBe(copyMedian(list));
            cases++;
        }
        expect(cases).toBe(300);
    });
});

/** The copy of the runner before the move to rigor-statistics, word for word: the reference of the move. */
function copyQuantile(values : readonly number[], q : number) : number {
    if (values.length === 0) return Number.NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.max(1, Math.ceil(q * sorted.length));
    return sorted[Math.min(rank, sorted.length) - 1]!;
}

describe("quantile of rigor-statistics, nearest rank", () => {
    const values = Array.from({ length : 100 }, (_, i) => i + 1);

    it("uses the nearest rank", () => {
        expect(quantile(values, 0.95, "nearest-rank")).toBe(95);
        expect(quantile(values, 0.5, "nearest-rank")).toBe(50);
        expect(quantile([7], 0.95, "nearest-rank")).toBe(7);
    });

    it("gives the lowest value for q = 0 and the highest for q = 1", () => {
        expect(quantile(values, 0, "nearest-rank")).toBe(1);
        expect(quantile(values, 1, "nearest-rank")).toBe(100);
    });

    it("gives the value of the copy for each list with values and each q", () => {
        // a seeded linear congruential generator gives the same lists in each run
        let seed = 7;
        const next = () : number => {
            seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
            return seed / 2_147_483_648;
        };
        const qs = [0, 0.01, 0.05, 0.25, 0.5, 0.75, 0.9, 0.95, 0.99, 1];
        let cases = 0;
        for (let n = 1; n <= 120; n++) {
            const list = Array.from({ length : n }, () => Math.round(next() * 1000) / 10);
            for (const q of qs) {
                expect(quantile(list, q, "nearest-rank")).toBe(copyQuantile(list, q));
                cases++;
            }
        }
        expect(cases).toBe(1200);
    });

    it("throws on a list with no values, where the copy gave NaN, so the caller keeps its guard", () => {
        expect(copyQuantile([], 0.95)).toBeNaN();
        expect(() => quantile([], 0.95, "nearest-rank")).toThrow(RangeError);
    });
});

describe("spread", () => {
    it("ignores the values that are not finite", () => {
        expect(spread([2, Number.NaN, 4, Number.POSITIVE_INFINITY, 3])).toEqual({ median : 3, min : 2, max : 4, n : 3 });
    });

    it("gives n = 0 for no finite values", () => {
        expect(spread([Number.NaN]).n).toBe(0);
    });
});

describe("roundOrder", () => {
    const setups = ["A", "B", "C", "D"] as const;

    it("rotates the setups in the first rounds", () => {
        expect(roundOrder(setups, 0)).toEqual(["A", "B", "C", "D"]);
        expect(roundOrder(setups, 1)).toEqual(["B", "C", "D", "A"]);
        expect(roundOrder(setups, 3)).toEqual(["D", "A", "B", "C"]);
    });

    it("reverses the rotations in the next rounds", () => {
        expect(roundOrder(setups, 4)).toEqual(["D", "C", "B", "A"]);
        expect(roundOrder(setups, 5)).toEqual(["A", "D", "C", "B"]);
    });

    it("gives a different order in each of 2n rounds, and each setup at each position", () => {
        const orders = Array.from({ length : 8 }, (_, round) => roundOrder(setups, round).join(""));
        expect(new Set(orders).size).toBe(8);
        for (const setup of setups) {
            const positions = new Set(orders.slice(0, 4).map(order => order.indexOf(setup)));
            expect(positions.size).toBe(4);
        }
    });

    it("gives no order for no items", () => {
        expect(roundOrder([], 3)).toEqual([]);
    });
});
