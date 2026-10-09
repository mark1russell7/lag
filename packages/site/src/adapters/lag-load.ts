/**
 * The only module of the site that uses `@lag/load`. It maps the load
 * actions of the playground to the generators and the workload profiles.
 */
import {
    burstyLoad,
    createRng,
    evolutionaryLoad,
    gcPressure,
    heavyLoad,
    kitchenSink,
    layoutThrash,
    lightLoad,
    longAnimationFrame,
    macrotaskFlood,
    microtaskFlood,
    moderateLoad,
    runWorkload,
    syncBusyWait,
    type WorkloadOptions,
} from "@lag/load";

export type LoadActionId =
    | "block-50"
    | "block-200"
    | "block-800"
    | "block-6000"
    | "layout-thrash"
    | "gc-pressure"
    | "long-animation-frame"
    | "macrotask-flood"
    | "microtask-flood";

export type ProfileId = "light" | "moderate" | "heavy" | "bursty" | "evolutionary" | "kitchen-sink";

const ACTIONS : Readonly<Record<LoadActionId, () => Promise<void>>> = {
    "block-50" : () => syncBusyWait(50),
    "block-200" : () => syncBusyWait(200),
    "block-800" : () => syncBusyWait(800),
    "block-6000" : () => syncBusyWait(6_000),
    "layout-thrash" : () => layoutThrash(150),
    "gc-pressure" : () => gcPressure(300),
    "long-animation-frame" : () => longAnimationFrame(150)(150),
    "macrotask-flood" : () => macrotaskFlood(1_000)(0),
    "microtask-flood" : () => microtaskFlood(200_000)(0),
};

const PROFILES : Readonly<Record<ProfileId, (durationMs : number, seed? : number) => WorkloadOptions>> = {
    "light" : lightLoad,
    "moderate" : moderateLoad,
    "heavy" : heavyLoad,
    "bursty" : burstyLoad,
    "evolutionary" : evolutionaryLoad,
    "kitchen-sink" : kitchenSink,
};

export const LOAD_ACTION_IDS = Object.keys(ACTIONS) as LoadActionId[];
export const PROFILE_IDS = Object.keys(PROFILES) as ProfileId[];

/** This function starts one load action. A blocking action blocks the main thread before the promise is complete. */
export function runLoadAction(id : LoadActionId) : Promise<void> {
    return ACTIONS[id]();
}

export type ProfileRun = {
    eventCount : number;
    totalLagMs : number;
    durationMs : number;
    /** True if the signal stopped the profile before its end. */
    aborted : boolean;
};

class ProfileAborted extends Error {
    constructor() {
        super("The profile run stopped.");
    }
}

/**
 * This function operates a workload profile for `durationMs`. `runWorkload`
 * has no stop control. Thus, the abort signal stops it at the next lag event.
 */
export async function runProfile(id : ProfileId, durationMs : number, signal? : AbortSignal) : Promise<ProfileRun> {
    const startedAt = performance.now();
    let eventCount = 0;
    try {
        const result = await runWorkload({
            ...PROFILES[id](durationMs),
            onEvent : () => {
                if (signal?.aborted) throw new ProfileAborted();
                eventCount++;
            },
        });
        return { eventCount : result.eventCount, totalLagMs : result.totalLagMs, durationMs : result.durationMs, aborted : false };
    } catch (error) {
        if (!(error instanceof ProfileAborted)) throw error;
        return { eventCount, totalLagMs : Number.NaN, durationMs : performance.now() - startedAt, aborted : true };
    }
}

export type SpecSample = {
    /** The name of the lag spec in the profile, for example "heavy-cpu". */
    spec : string;
    /** The relative weight of the spec in the profile. */
    weight : number;
    values : number[];
};

/**
 * This function takes samples of the duration distribution of each lag spec
 * in a profile, with a fixed seed. It makes no load: it only draws numbers.
 */
export function sampleProfileDurations(id : ProfileId, samplesPerSpec : number, seed : number) : SpecSample[] {
    const rng = createRng(seed);
    return PROFILES[id](0, seed).specs.map(spec => ({
        spec : spec.name,
        weight : spec.weight ?? 1,
        values : Array.from({ length : samplesPerSpec }, () => spec.durationDist(rng)),
    }));
}
