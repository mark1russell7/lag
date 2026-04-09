import { createRng, type Rng } from "./rng.js";
import type { Distribution } from "./distributions.js";
import type { LagGenerator } from "./generators.js";

/**
 * A LagSpec couples a generator with a distribution that produces its
 * `durationMs` argument. Optionally weight it relative to other specs in
 * a workload — heavier weight = more frequent selection.
 */
export type LagSpec = {
    name : string;
    generator : LagGenerator;
    durationDist : Distribution;
    weight? : number;
};

export type WorkloadOptions = {
    /** Total wall-clock time the workload runs for, in ms. */
    durationMs : number;

    /** Distribution producing inter-event idle gaps in ms. */
    interEventGapDist : Distribution;

    /** The set of lag specs to draw from. */
    specs : LagSpec[];

    /** RNG seed (default: time-based). */
    seed? : number;

    /** Optional callback fired before each lag event. */
    onEvent? : (event : WorkloadEvent) => void;
};

export type WorkloadEvent = {
    name : string;
    durationMs : number;
    elapsedMs : number;     // wall time since workload started
    eventIndex : number;
};

export type WorkloadResult = {
    seed : number;
    eventCount : number;
    totalLagMs : number;
    durationMs : number;
    eventsByName : Record<string, number>;
};

const wait = (ms : number) : Promise<void> =>
    new Promise(resolve => setTimeout(resolve, ms));

/**
 * Picks a spec from the workload according to its weights.
 */
function pickSpec(rng : Rng, specs : LagSpec[]) : LagSpec {
    const total = specs.reduce((s, c) => s + (c.weight ?? 1), 0);
    let r = rng.next() * total;
    for (const spec of specs) {
        r -= spec.weight ?? 1;
        if (r <= 0) return spec;
    }
    return specs[specs.length - 1]!;
}

/**
 * Runs a synthetic workload for `durationMs` wall-clock time.
 *
 * Each iteration:
 *   1. Picks a lag spec (weighted)
 *   2. Samples a duration from the spec's distribution
 *   3. Waits a random idle gap
 *   4. Fires the lag generator
 *
 * Returns a summary of what happened. Reproducible given the same seed.
 */
export async function runWorkload(options : WorkloadOptions) : Promise<WorkloadResult> {
    const seed = options.seed ?? Date.now();
    const rng = createRng(seed);
    const startTime = performance.now();
    const eventsByName : Record<string, number> = {};
    let totalLagMs = 0;
    let eventIndex = 0;

    while (performance.now() - startTime < options.durationMs) {
        // Idle gap
        const gap = options.interEventGapDist(rng);
        if (gap > 0) await wait(gap);

        // Bail out if we're already past budget
        if (performance.now() - startTime >= options.durationMs) break;

        // Pick + execute a lag event
        const spec = pickSpec(rng, options.specs);
        const durationMs = spec.durationDist(rng);
        const elapsedMs = performance.now() - startTime;

        const event : WorkloadEvent = {
            name : spec.name,
            durationMs,
            elapsedMs,
            eventIndex,
        };
        options.onEvent?.(event);

        await spec.generator(durationMs);

        eventsByName[spec.name] = (eventsByName[spec.name] ?? 0) + 1;
        totalLagMs += durationMs;
        eventIndex++;
    }

    return {
        seed,
        eventCount : eventIndex,
        totalLagMs,
        durationMs : performance.now() - startTime,
        eventsByName,
    };
}
