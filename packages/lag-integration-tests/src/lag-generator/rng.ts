/**
 * Seedable pseudo-random number generator (mulberry32).
 *
 * Math.random() is non-seedable and produces non-reproducible test runs.
 * This RNG is fast, statistically good for stress testing (NOT crypto), and
 * fully reproducible — same seed → same sequence.
 */
export type Rng = {
    /** Uniform float in [0, 1). */
    next() : number;
    /** Uniform integer in [min, max] inclusive. */
    int(min : number, max : number) : number;
    /** Uniform float in [min, max). */
    range(min : number, max : number) : number;
    /** Standard normal sample via Box-Muller. */
    normal() : number;
    /** Pick one element from an array uniformly. */
    pick<T>(arr : readonly T[]) : T;
    /** Bernoulli trial — true with probability p. */
    bool(p : number) : boolean;
    /** Get the current seed (for reproducibility/logging). */
    seed() : number;
};

export function createRng(seed = Date.now() >>> 0) : Rng {
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
