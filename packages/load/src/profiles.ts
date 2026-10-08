import {
    constant,
    normal,
    powerLaw,
    bimodal,
    evolutionary,
    exponential,
} from "./distributions.js";
import {
    syncBusyWait,
    syncCompute,
    gcPressure,
    microtaskFlood,
    macrotaskFlood,
    promiseChain,
    layoutThrash,
    longAnimationFrame,
} from "./generators.js";
import type { WorkloadOptions } from "./workload.js";

/**
 * Ready-made workload profiles, for stress tests of the lag monitoring
 * stack.
 *
 * Each profile is a function that gives the `WorkloadOptions` for a given
 * duration. Give a `seed` to repeat a run with the same values.
 */

// ─── Light load ────────────────────────────────────────────────────────────
/**
 * Mostly idle, with occasional small CPU spikes (approximately 5 to 20 ms).
 * The profile looks like a calm app: no dropped frames, and a p99 lag below
 * 100 ms.
 */
export function lightLoad(durationMs : number, seed? : number) : WorkloadOptions {
    return {
        durationMs,
        seed,
        interEventGapDist : exponential(1 / 500), // mean 500ms gap
        specs : [
            {
                name : "small-cpu",
                generator : syncBusyWait,
                durationDist : normal(10, 5, 1, 30),
                weight : 5,
            },
            {
                name : "tiny-microtask",
                generator : microtaskFlood(50),
                durationDist : constant(0),
                weight : 2,
            },
        ],
    };
}

// ─── Moderate load ─────────────────────────────────────────────────────────
/**
 * A realistic mid-range web app: occasional layout, mid-range CPU, and some
 * macrotask scheduling pressure.
 */
export function moderateLoad(durationMs : number, seed? : number) : WorkloadOptions {
    return {
        durationMs,
        seed,
        interEventGapDist : exponential(1 / 200),
        specs : [
            {
                name : "cpu-burst",
                generator : syncCompute,
                durationDist : normal(30, 15, 5, 100),
                weight : 4,
            },
            {
                name : "macrotask-burst",
                generator : macrotaskFlood(20),
                durationDist : constant(0),
                weight : 2,
            },
            {
                name : "layout-thrash",
                generator : layoutThrash,
                durationDist : normal(20, 10, 5, 60),
                weight : 1,
            },
            {
                name : "loaf",
                generator : longAnimationFrame(50),
                durationDist : constant(50),
                weight : 1,
            },
        ],
    };
}

// ─── Heavy load ────────────────────────────────────────────────────────────
/**
 * Sustained CPU pressure with occasional huge spikes (a power-law tail). The
 * profile tries to trigger all monitors: dropped frames, GC spikes and
 * throttle warnings.
 */
export function heavyLoad(durationMs : number, seed? : number) : WorkloadOptions {
    return {
        durationMs,
        seed,
        interEventGapDist : exponential(1 / 100),
        specs : [
            {
                name : "heavy-cpu",
                generator : syncCompute,
                durationDist : normal(100, 50, 20, 300),
                weight : 5,
            },
            {
                name : "spike",
                generator : syncBusyWait,
                durationDist : powerLaw(50, 1.5, 1000),
                weight : 1,
            },
            {
                name : "gc-pressure",
                generator : gcPressure,
                durationDist : normal(40, 15, 10, 100),
                weight : 2,
            },
            {
                name : "layout-thrash",
                generator : layoutThrash,
                durationDist : normal(60, 25, 20, 200),
                weight : 2,
            },
            {
                name : "loaf-long",
                generator : longAnimationFrame(120),
                durationDist : constant(120),
                weight : 1,
            },
        ],
    };
}

// ─── Bursty load ───────────────────────────────────────────────────────────
/**
 * Bimodal: most events are tiny (approximately 5 ms), but approximately 5%
 * are huge (approximately 400 ms). The profile stresses the measurement of
 * the p99 and of the worst case.
 */
export function burstyLoad(durationMs : number, seed? : number) : WorkloadOptions {
    return {
        durationMs,
        seed,
        interEventGapDist : exponential(1 / 150),
        specs : [
            {
                name : "bimodal-cpu",
                generator : syncBusyWait,
                durationDist : bimodal(
                    0.95,
                    normal(5, 2, 1, 20),    // 95% small
                    normal(400, 100, 200, 1500), // 5% huge
                ),
                weight : 1,
            },
            {
                name : "promise-chain",
                generator : promiseChain(200),
                durationDist : constant(0),
                weight : 1,
            },
        ],
    };
}

// ─── Evolutionary load ─────────────────────────────────────────────────────
/**
 * Conditions degrade over time, as with memory leaks or with state that
 * accumulates. The lag durations follow a random walk that drifts upward.
 *
 * Use this profile to test if the dashboard finds "things getting worse",
 * compared to point-in-time regressions.
 */
export function evolutionaryLoad(durationMs : number, seed? : number) : WorkloadOptions {
    return {
        durationMs,
        seed,
        interEventGapDist : exponential(1 / 250),
        specs : [
            {
                name : "drifting-cpu",
                generator : syncCompute,
                // Starts at ~10ms, drifts up to potentially 500ms
                durationDist : evolutionary(10, 8, 1, 500),
                weight : 5,
            },
            {
                name : "drifting-gc",
                generator : gcPressure,
                durationDist : evolutionary(20, 5, 5, 200),
                weight : 2,
            },
        ],
    };
}

// ─── Mixed kitchen sink ────────────────────────────────────────────────────
/**
 * This profile gives all types of workload to the monitors at the same time.
 * It is the acid test.
 */
export function kitchenSink(durationMs : number, seed? : number) : WorkloadOptions {
    return {
        durationMs,
        seed,
        interEventGapDist : exponential(1 / 100),
        specs : [
            { name : "cpu-normal",     generator : syncCompute,         durationDist : normal(20, 10, 1, 80),          weight : 4 },
            { name : "cpu-spike",      generator : syncBusyWait,        durationDist : powerLaw(30, 1.7, 800),         weight : 1 },
            { name : "gc",             generator : gcPressure,          durationDist : normal(30, 15, 5, 150),         weight : 2 },
            { name : "layout",         generator : layoutThrash,        durationDist : normal(40, 15, 10, 120),        weight : 2 },
            { name : "loaf",           generator : longAnimationFrame(80), durationDist : constant(80),                weight : 1 },
            { name : "microtask",      generator : microtaskFlood(100), durationDist : constant(0),                    weight : 2 },
            { name : "macrotask",      generator : macrotaskFlood(30),  durationDist : constant(0),                    weight : 2 },
            { name : "promise-chain",  generator : promiseChain(150),   durationDist : constant(0),                    weight : 1 },
        ],
    };
}
