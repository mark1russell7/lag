import { mulberry32, randomOf } from "@mark1russell7/rigor-generators";

/**
 * A pseudo-random number generator with a seed. The step is `mulberry32` and the methods are
 * `randomOf` of `@mark1russell7/rigor-generators`, the home of seeded random numbers.
 *
 * `Math.random()` has no seed. Thus, a test run with it cannot be repeated
 * with the same values. This generator is fast and statistically good for
 * stress tests, but not for cryptography. It is fully reproducible: the same
 * seed gives the same sequence.
 */
export type Rng = {
    /** A uniform float in [0, 1). */
    next() : number;
    /** A uniform integer in [min, max], with the two limits. A limit that is not an integer, or `min > max`, is a `RangeError`. */
    int(min : number, max : number) : number;
    /** A uniform float in [min, max). */
    range(min : number, max : number) : number;
    /** A standard normal sample, from the Box-Muller transform. */
    normal() : number;
    /** One element of the array, with a uniform probability. An empty array is a `RangeError`. */
    pick<T>(arr : readonly T[]) : T;
    /** A Bernoulli trial: `true` with the probability `p`. */
    bool(p : number) : boolean;
    /** The seed that the generator started with (for reproducibility and logs). */
    seed() : number;
};

export function createRng(seed : number = Date.now() >>> 0) : Rng {
    const random = randomOf(mulberry32(seed), seed >>> 0);

    return {
        next : random.next,
        int : random.int,
        range : random.range,
        normal : () => random.normal(),
        pick : random.pick,
        bool : random.chance,
        // The seed as the caller gave it, also when it is not a 32-bit integer
        seed : () => seed,
    };
}
