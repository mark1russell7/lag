import { describe, expect, it } from "vitest";
import { median, quantile, spread } from "./stats.js";
import { roundOrder } from "./plan.js";

describe("median", () => {
    it("gives the middle value of an odd count", () => {
        expect(median([5, 1, 3])).toBe(3);
    });

    it("gives the mean of the two middle values of an even count", () => {
        expect(median([4, 1, 3, 2])).toBe(2.5);
    });

    it("gives NaN for no values", () => {
        expect(median([])).toBeNaN();
    });
});

describe("quantile", () => {
    const values = Array.from({ length : 100 }, (_, i) => i + 1);

    it("uses the nearest rank", () => {
        expect(quantile(values, 0.95)).toBe(95);
        expect(quantile(values, 0.5)).toBe(50);
        expect(quantile([7], 0.95)).toBe(7);
    });

    it("gives the lowest value for q = 0 and the highest for q = 1", () => {
        expect(quantile(values, 0)).toBe(1);
        expect(quantile(values, 1)).toBe(100);
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
