import type { Rng } from "./rng.js";

/**
 * A `Distribution` is a function that takes an RNG and gives a numeric
 * sample, usually a duration in milliseconds. The distributions with `min`
 * and `max` parameters clamp their samples to [min, max]. Thus, the callers
 * can bound the worst-case behavior.
 */
export type Distribution = (rng : Rng) => number;

// ─── Helper: clamp ──────────────────────────────────────────────────────────

const clamp = (v : number, min : number, max : number) : number =>
    v < min ? min : v > max ? max : v;

// ─── Uniform ────────────────────────────────────────────────────────────────

/** A uniform random value in [min, max). */
export function uniform(min : number, max : number) : Distribution {
    return (rng) => rng.range(min, max);
}

// ─── Constant ───────────────────────────────────────────────────────────────

/** A distribution that always gives the same value (for baselines and control groups). */
export function constant(value : number) : Distribution {
    return () => value;
}

// ─── Normal (Gaussian) ──────────────────────────────────────────────────────

/**
 * A normal distribution N(mean, stddev), clamped to [min, max]. Use it for
 * noise around a typical value, for example a typical request latency.
 */
export function normal(
    mean : number,
    stddev : number,
    min : number = 0,
    max : number = Infinity,
) : Distribution {
    return (rng) => clamp(mean + rng.normal() * stddev, min, max);
}

// ─── Exponential ────────────────────────────────────────────────────────────

/**
 * An exponential distribution with the rate `lambda`. The mean is
 * `1 / lambda`. Most values are small, and some values are larger. The
 * distribution models the inter-arrival times of independent events.
 */
export function exponential(
    lambda : number,
    min : number = 0,
    max : number = Infinity,
) : Distribution {
    return (rng) => {
        const u = Math.max(rng.next(), 1e-12);
        return clamp(-Math.log(u) / lambda, min, max);
    };
}

// ─── Power Law (Pareto) ─────────────────────────────────────────────────────

/**
 * A Pareto distribution: the classic "long tail". `xMin` is the lower bound.
 * `alpha` controls the heaviness of the tail: a smaller `alpha` gives a
 * fatter tail.
 *
 * `P(X > x) = (xMin / x)^alpha`
 *
 * Real-world response times, lag spikes, GC pauses and "1% tail" latencies
 * frequently follow power laws. Use this distribution to stress p95 and p99
 * monitors.
 */
export function powerLaw(
    xMin : number,
    alpha : number,
    max : number = Infinity,
) : Distribution {
    return (rng) => {
        const u = Math.max(rng.next(), 1e-12);
        return clamp(xMin / Math.pow(u, 1 / alpha), xMin, max);
    };
}

// ─── Bimodal ────────────────────────────────────────────────────────────────

/**
 * This function picks one of two distributions for each sample: `distA`
 * with the probability `pA`, and `distB` if not. Use it for "fast/slow"
 * patterns, for example 95% cache hits and 5% cache misses.
 */
export function bimodal(
    pA : number,
    distA : Distribution,
    distB : Distribution,
) : Distribution {
    return (rng) => (rng.bool(pA) ? distA(rng) : distB(rng));
}

// ─── Mixture ────────────────────────────────────────────────────────────────

/**
 * A mixture of n components. The sum of the weights can be different from 1,
 * because the function normalizes the weights.
 */
export function mixture(
    components : Array<{ weight : number; dist : Distribution }>,
) : Distribution {
    const total = components.reduce((s, c) => s + c.weight, 0);
    return (rng) => {
        let pick = rng.next() * total;
        for (const c of components) {
            pick -= c.weight;
            if (pick <= 0) return c.dist(rng);
        }
        return components[components.length - 1]!.dist(rng);
    };
}

// ─── Evolutionary ───────────────────────────────────────────────────────────

/**
 * An "evolutionary" distribution: the value drifts over time as a random
 * walk. Each call advances the internal state by one step. Use it to
 * simulate conditions that degrade gradually.
 *
 * @param initial   The start value
 * @param stepStdDev The standard deviation of each step of the random walk
 * @param min       The lower clamp
 * @param max       The upper clamp
 */
export function evolutionary(
    initial : number,
    stepStdDev : number,
    min : number = 0,
    max : number = Infinity,
) : Distribution {
    let value = initial;
    return (rng) => {
        value = clamp(value + rng.normal() * stepStdDev, min, max);
        return value;
    };
}

// ─── On/Off (bursty) ────────────────────────────────────────────────────────

/**
 * Bursty traffic: periods of activity, then idle periods. In an "on" phase,
 * the distribution gives the samples of `activeDist`. In an "off" phase, it
 * gives 0.
 *
 * Each call advances the phase counter. The state is internal.
 */
export function burst(
    onLength : number,
    offLength : number,
    activeDist : Distribution,
) : Distribution {
    let counter = 0;
    return (rng) => {
        const totalCycle = onLength + offLength;
        const phase = counter % totalCycle;
        counter++;
        return phase < onLength ? activeDist(rng) : 0;
    };
}

// ─── Take a series of N samples ─────────────────────────────────────────────

/** This function takes `count` samples from a distribution and gives them as an array. */
export function sample(dist : Distribution, count : number, rng : Rng) : number[] {
    const out = new Array<number>(count);
    for (let i = 0; i < count; i++) out[i] = dist(rng);
    return out;
}
