import { createRng, type Rng } from "./rng.js";
import type { Distribution } from "./distributions.js";
import type { LagGenerator } from "./generators.js";

/**
 * A `LagSpec` couples a generator with a distribution that gives its
 * `durationMs` argument. You can give the spec a weight relative to the
 * other specs of a workload. A heavier weight gives a more frequent
 * selection.
 */
export type LagSpec = {
    name : string;
    generator : LagGenerator;
    durationDist : Distribution;
    weight? : number;
};

export type WorkloadOptions = {
    /** The total elapsed time of the workload, in ms. */
    durationMs : number;

    /** The distribution of the idle gaps between the events, in ms. */
    interEventGapDist : Distribution;

    /** The set of lag specs to draw from. */
    specs : LagSpec[];

    /** The seed of the random number generator. The default is `Date.now()`. */
    seed? : number | undefined;

    /** An optional callback that the workload uses before each lag event. */
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
 * This function picks a spec from the workload, with the probabilities of
 * the weights.
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
 * This function starts a synthetic workload for `durationMs` of elapsed
 * time.
 *
 * Each iteration does these steps:
 *
 * 1. Wait for a random idle gap. Stop if the elapsed time is `durationMs`
 *    or more.
 * 2. Pick a lag spec, with the weights.
 * 3. Sample a duration from the distribution of the spec.
 * 4. Start the lag generator.
 *
 * The function gives a summary of the events. With the same seed, it picks
 * the same sequence of gaps, specs and durations.
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
