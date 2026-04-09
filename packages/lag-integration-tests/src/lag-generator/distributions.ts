import type { Rng } from "./rng.js";

/**
 * A `Distribution` is a function that, given an RNG, returns a numeric sample
 * (typically a duration in milliseconds). All distributions clamp to [min, max]
 * so callers can bound worst-case behavior.
 */
export type Distribution = (rng : Rng) => number;

// ─── Helper: clamp ──────────────────────────────────────────────────────────

const clamp = (v : number, min : number, max : number) : number =>
    v < min ? min : v > max ? max : v;

// ─── Uniform ────────────────────────────────────────────────────────────────

/** Uniform random in [min, max). */
export function uniform(min : number, max : number) : Distribution {
    return (rng) => rng.range(min, max);
}

// ─── Constant ───────────────────────────────────────────────────────────────

/** Always returns the same value (useful for baselines/control). */
export function constant(value : number) : Distribution {
    return () => value;
}

// ─── Normal (Gaussian) ──────────────────────────────────────────────────────

/**
 * Normal distribution N(mean, stddev), clamped to [min, max].
 * Use for noise around a typical value (e.g., typical request latency).
 */
export function normal(
    mean : number,
    stddev : number,
    min = 0,
    max = Infinity,
) : Distribution {
    return (rng) => clamp(mean + rng.normal() * stddev, min, max);
}

// ─── Exponential ────────────────────────────────────────────────────────────

/**
 * Exponential distribution with given rate (lambda).
 * Mean = 1/lambda. Heavy on small values, occasional larger ones.
 * Models inter-arrival times of independent events.
 */
export function exponential(
    lambda : number,
    min = 0,
    max = Infinity,
) : Distribution {
    return (rng) => {
        const u = Math.max(rng.next(), 1e-12);
        return clamp(-Math.log(u) / lambda, min, max);
    };
}

// ─── Power Law (Pareto) ─────────────────────────────────────────────────────

/**
 * Pareto distribution — the classic "long tail".
 * `xMin` is the lower bound; `alpha` controls tail heaviness (smaller α → fatter tail).
 *
 * P(X > x) = (xMin / x)^alpha
 *
 * Real-world response times, lag spikes, GC pauses, and "1% tail" latencies
 * often follow power laws. Use this to stress p95/p99 monitors.
 */
export function powerLaw(
    xMin : number,
    alpha : number,
    max = Infinity,
) : Distribution {
    return (rng) => {
        const u = Math.max(rng.next(), 1e-12);
        return clamp(xMin / Math.pow(u, 1 / alpha), xMin, max);
    };
}

// ─── Bimodal ────────────────────────────────────────────────────────────────

/**
 * Picks between two underlying distributions with the given probability.
 * Use for "fast/slow" patterns: e.g., 95% cache hits + 5% cache misses.
 */
export function bimodal(
    pA : number,
    distA : Distribution,
    distB : Distribution,
) : Distribution {
    return (rng) => (rng.bool(pA) ? distA(rng) : distB(rng));
}

// ─── Mixture ────────────────────────────────────────────────────────────────

/** Generalized n-component mixture (weights need not sum to 1; they're normalized). */
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
 * An "evolutionary" distribution where the underlying parameters drift over
 * time according to a random walk. Each call advances the internal state by
 * one step. Useful for simulating gradually-degrading conditions.
 *
 * @param initial   Starting value
 * @param stepStdDev Standard deviation of each random walk step
 * @param min       Lower clamp
 * @param max       Upper clamp
 */
export function evolutionary(
    initial : number,
    stepStdDev : number,
    min = 0,
    max = Infinity,
) : Distribution {
    let value = initial;
    return (rng) => {
        value = clamp(value + rng.normal() * stepStdDev, min, max);
        return value;
    };
}

// ─── On/Off (bursty) ────────────────────────────────────────────────────────

/**
 * Bursty traffic — periods of activity followed by idle periods.
 * Returns the active distribution during "on" phases and 0 during "off".
 *
 * Each call advances the phase counter. State is internal.
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

/** Convenience: pull N samples from a distribution as an array. */
export function sample(dist : Distribution, count : number, rng : Rng) : number[] {
    const out = new Array<number>(count);
    for (let i = 0; i < count; i++) out[i] = dist(rng);
    return out;
}
