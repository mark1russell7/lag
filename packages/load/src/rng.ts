/**
 * A pseudo-random number generator with a seed (mulberry32).
 *
 * `Math.random()` has no seed. Thus, a test run with it cannot be repeated
 * with the same values. This generator is fast and statistically good for
 * stress tests, but not for cryptography. It is fully reproducible: the same
 * seed gives the same sequence.
 */
export type Rng = {
    /** A uniform float in [0, 1). */
    next() : number;
    /** A uniform integer in [min, max], with the two limits. */
    int(min : number, max : number) : number;
    /** A uniform float in [min, max). */
    range(min : number, max : number) : number;
    /** A standard normal sample, from the Box-Muller transform. */
    normal() : number;
    /** One element of the array, with a uniform probability. */
    pick<T>(arr : readonly T[]) : T;
    /** A Bernoulli trial: `true` with the probability `p`. */
    bool(p : number) : boolean;
    /** The seed that the generator started with (for reproducibility and logs). */
    seed() : number;
};

export function createRng(seed : number = Date.now() >>> 0) : Rng {
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
