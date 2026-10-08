import type { PerformanceLike } from "./types.js";

/**
 * The resolution of `performance.now()` is a multiple of 5 μs (Chrome) or
 * 20 μs (Firefox and Safari) in cross-origin-isolated contexts. In other
 * contexts, it is 100 μs (Chrome) to 1 ms (Firefox and Safari). This
 * coarsening is a mitigation of Spectre. 50 μs separates the two groups,
 * with a margin on the two sides.
 *
 * `globalThis.crossOriginIsolated` is the authoritative flag. This checker
 * answers the question that is important for measurements: how fine is the
 * clock?
 */
const HIGH_RES_THRESHOLD_MS = 0.05;

/**
 * The checker stops the sampling after this number of clock ticks. One tick
 * already shows the resolution. More ticks give protection against a
 * partial first step.
 */
const RESOLUTION_TICKS = 5;

/**
 * The maximum number of `performance.now()` calls (a few ms of CPU time). A
 * 1 ms clock possibly does not tick 5 times in these calls, but one tick is
 * enough.
 */
const MAX_SAMPLES = 100_000;

export class ClockReliabilityChecker {
    private resolutionMs : number | undefined;

    constructor(
        private readonly performance : PerformanceLike,
    ) {}

    /**
     * This method estimates the resolution of `performance.now()`: the
     * smallest delta between consecutive readings that is not zero. The
     * method measures the resolution one time and keeps the result, because
     * the resolution does not change during the lifetime of a page.
     *
     * The method gives 0 if the clock did not advance during the sampling (a
     * very coarse clock). Then the next call samples again.
     */
    getResolutionMs() : number {
        if (this.resolutionMs === undefined) {
            const measured = this.measureResolution();
            if (measured > 0) this.resolutionMs = measured;
            return measured;
        }
        return this.resolutionMs;
    }

    /** True if `performance.now()` has the precision of a cross-origin-isolated context (finer than 50 μs). */
    isHighResolution() : boolean {
        const resolution = this.getResolutionMs();
        return resolution > 0 && resolution < HIGH_RES_THRESHOLD_MS;
    }

    /**
     * This method gives the time origin of the page: the wall-clock time, in
     * ms, when the navigation started. Use it to change `performance.now()`
     * values into wall-clock timestamps, and to correlate them with other
     * systems.
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
