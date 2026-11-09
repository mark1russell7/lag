import { describe, expect, it } from "vitest";
import { createRng, type Rng } from "./rng.js";

/** The generator of this package before the move to `@mark1russell7/rigor-generators`, word for word. */
function copyCreateRng(seed : number = Date.now() >>> 0) : Rng {
    let state = seed >>> 0;

    const next = () : number => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    return {
        next,
        int : (min : number, max : number) =>
            Math.floor(next() * (max - min + 1)) + min,
        range : (min : number, max : number) =>
            min + next() * (max - min),
        normal : () => {
            // Box-Muller transform — produces N(0,1) from two uniforms
            const u1 = Math.max(next(), 1e-12);
            const u2 = next();
            return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        },
        pick : <T>(arr : readonly T[]) : T => arr[Math.floor(next() * arr.length)]!,
        bool : (p : number) => next() < p,
        seed : () => seed,
    };
}

const ITEMS = ["a", "b", "c", "d", "e", "f", "g"] as const;

/** The draws of each method, in turn, so each method reads the stream at a different place. */
function draws(rng : Rng, count : number) : unknown[] {
    const out : unknown[] = [rng.seed()];
    for (let i = 0; i < count; i++) {
        out.push(rng.next(), rng.int(-3, 9), rng.int(0, 0), rng.range(-2.5, 7.25), rng.normal(), rng.pick(ITEMS), rng.bool(0.3), rng.int(-(2 ** 31), 2 ** 31));
    }
    return out;
}

describe("createRng on randomOf of @mark1russell7/rigor-generators", () => {
    it("gives the same draws as the copy for each seed, with valid inputs", () => {
        const seeds = [0, 1, 7, 42, 123, 2 ** 31, 2 ** 32 - 1, 2 ** 32, -1, -42, 1.5, 123_456.789, Number.NaN];
        for (let seed = 0; seed < 2000; seed += 13) seeds.push(seed * 2_654_435_761);
        for (const seed of seeds) {
            expect(draws(createRng(seed), 100), `seed ${seed}`).toEqual(draws(copyCreateRng(seed), 100));
        }
    });

    it("keeps the seed that it got, also when the seed is not a 32-bit integer", () => {
        expect(createRng(-1).seed()).toBe(-1);
        expect(createRng(1.5).seed()).toBe(1.5);
    });

    // The three inputs where the home is stricter than the copy. No caller of this repository gives them.
    it("throws on the inputs that the copy took without an error", () => {
        const copy = copyCreateRng(42);
        expect(() => copy.int(1.5, 4.5)).not.toThrow();
        expect(() => copy.int(9, 3)).not.toThrow();
        expect(copy.pick([])).toBeUndefined();
        const rng = createRng(42);
        expect(() => rng.int(1.5, 4.5)).toThrow(RangeError);
        expect(() => rng.int(9, 3)).toThrow(RangeError);
        expect(() => rng.pick([])).toThrow(RangeError);
    });
});
