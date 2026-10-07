import type { PerformanceLike } from "./types.js";

/**
 * `performance.now()` resolution is a multiple of 5μs (Chrome) or 20μs
 * (Firefox) in cross-origin-isolated contexts, and 100μs (Chrome) to 1ms
 * (Firefox, Safari) otherwise — a Spectre mitigation. 50μs separates the two
 * groups with margin on both sides.
 *
 * `globalThis.crossOriginIsolated` is the authoritative flag; this checker
 * answers the question that matters for measurements: how fine is the clock?
 */
const HIGH_RES_THRESHOLD_MS = 0.05;

/**
 * Stop sampling after this many clock ticks. Any single tick already shows
 * the resolution; a few more guard against a partial first step.
 */
const RESOLUTION_TICKS = 5;

/**
 * Upper bound on `performance.now()` calls (a few ms of CPU). A 1ms clock
 * may not tick 5 times within it, but one tick is enough.
 */
const MAX_SAMPLES = 100_000;

export class ClockReliabilityChecker {
    private resolutionMs : number | undefined;

    constructor(
        private readonly performance : PerformanceLike,
    ) {}

    /**
     * Estimates the resolution of `performance.now()`: the smallest non-zero
     * delta between consecutive readings. Measured once, then cached — the
     * resolution doesn't change during a page's lifetime.
     *
     * Returns 0 if the clock never advanced while sampling (a very coarse
     * clock); the next call samples again.
     */
    getResolutionMs() : number {
        if (this.resolutionMs === undefined) {
            const measured = this.measureResolution();
            if (measured > 0) this.resolutionMs = measured;
            return measured;
        }
        return this.resolutionMs;
    }

    /** True if `performance.now()` has cross-origin-isolated precision (finer than 50μs). */
    isHighResolution() : boolean {
        const resolution = this.getResolutionMs();
        return resolution > 0 && resolution < HIGH_RES_THRESHOLD_MS;
    }

    /**
     * Returns the page's time origin (wall-clock ms when the navigation
     * started). Useful for converting `performance.now()` values into wall
     * timestamps for cross-system correlation.
     */
    getTimeOrigin() : number {
        return this.performance.timeOrigin;
    }

    private measureResolution() : number {
        let minDelta = Infinity;
        let ticks = 0;
        let prev = this.performance.now();

        for (let i = 0; i < MAX_SAMPLES && ticks < RESOLUTION_TICKS; i++) {
            const curr = this.performance.now();
            const delta = curr - prev;
            if (delta > 0) {
                ticks++;
                if (delta < minDelta) minDelta = delta;
                prev = curr;
            }
        }

        return minDelta === Infinity ? 0 : minDelta;
    }
}
