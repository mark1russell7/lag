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
 * Pre-built workload profiles for stress testing the lag monitoring stack.
 *
 * Each profile is a function returning a WorkloadOptions for a given duration.
 * Pass `seed` for reproducibility.
 */

// ─── Light load ────────────────────────────────────────────────────────────
/**
 * Mostly idle with occasional small CPU spikes (~5–20ms). Designed to look
 * like a calm app: no dropped frames, sub-100ms p99 lag.
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
 * Realistic mid-range web app: occasional layout, mid-range CPU, some
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
 * Sustained CPU pressure with occasional huge spikes (power law tail).
 * Should trigger every monitor: dropped frames, GC spikes, throttle warnings.
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
 * Bimodal: most events are tiny (~5ms), but ~5% are huge (~500ms).
 * Stresses p99 detection and the worst-case-tracking gauges.
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
 * Conditions degrade over time — typical of memory leaks or accumulating
 * state. Lag durations follow a random walk that drifts upward.
 *
 * Great for testing whether the dashboard catches "things getting worse"
 * vs. point-in-time regressions.
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
 * Throws everything at the monitors at once. The acid test.
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
