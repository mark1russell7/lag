export type PerformanceLike = {
    now : () => number;
    timeOrigin : number;
};

/**
 * 5μs — the High Resolution Time Level 3 spec defines this as the maximum
 * resolution for cross-origin-isolated contexts. Without COI, browsers
 * round to ~100μs to mitigate timing-based fingerprinting attacks (per the
 * Spectre mitigations rolled out in 2018). So if `performance.now()` resolves
 * finer than 5μs, the page is almost certainly cross-origin isolated.
 *
 * Spec reference: https://www.w3.org/TR/hr-time-3/#sec-domhighrestimestamp
 */
const HIGH_RES_THRESHOLD_MS = 0.005;

/**
 * Number of consecutive `performance.now()` calls used to estimate clock
 * resolution. 100 is enough to find the minimum non-zero delta in well under
 * 1ms of CPU time, even on slow devices.
 */
const RESOLUTION_SAMPLE_COUNT = 100;

export class ClockReliabilityChecker {
    constructor(
        private readonly performance : PerformanceLike,
    ) {}

    /**
     * Estimates the actual resolution of `performance.now()` by sampling it
     * in a tight loop and returning the smallest non-zero delta observed.
     *
     * Note: this is a lower bound. The hardware clock may be even finer,
     * but the JS engine clamps to whatever the security policy allows.
     */
    getResolutionMs() : number {
        let minDelta = Infinity;
        let prev = this.performance.now();

        for (let i = 0; i < RESOLUTION_SAMPLE_COUNT; i++) {
            const curr = this.performance.now();
            const delta = curr - prev;
            if (delta > 0 && delta < minDelta) {
                minDelta = delta;
            }
            prev = curr;
        }

        return minDelta === Infinity ? 0 : minDelta;
    }

    /**
     * Returns true if `performance.now()` resolves to ~5μs or finer, which
     * is the spec-defined precision for cross-origin-isolated contexts.
     */
    isCrossOriginIsolated() : boolean {
        return this.getResolutionMs() <= HIGH_RES_THRESHOLD_MS;
    }

    /**
     * Returns the page's time origin (wall-clock ms when the navigation
     * started). Useful for converting `performance.now()` values into wall
     * timestamps for cross-system correlation.
     */
    getTimeOrigin() : number {
        return this.performance.timeOrigin;
    }
}
