import type { Clock, Logger, SetTimeoutFn } from "./types.js";

/**
 * Default constants — chosen by spec, not by feel.
 *
 * - CALIBRATION_TARGET_MS = 5: small enough to be well below the 4ms minimum
 *   nested-setTimeout clamp the HTML spec defines after 5 nested levels, so
 *   *unthrottled* timers should fire near this delay.
 *
 * - THROTTLE_THRESHOLD_MS = 100: background tabs are throttled to 1Hz
 *   (1000ms) per the HTML spec; 100ms is a conservative midpoint that
 *   catches both partial throttling (intersection-aware throttling, ~50ms)
 *   and full background throttling (~1000ms).
 *
 * - CALIBRATION_SAMPLES = 5: smallest odd number where a strict majority
 *   (3 of 5) gives a stable signal without taking too long.
 *
 * - DEFAULT_CALIBRATION_INTERVAL_MS = 10_000: long enough to avoid being a
 *   noticeable timer source itself, short enough to detect a throttle
 *   transition within ~10s of it happening.
 *
 * All can be overridden via the constructor.
 */
const DEFAULT_CALIBRATION_TARGET_MS = 5;
const DEFAULT_CALIBRATION_SAMPLES = 5;
const DEFAULT_THROTTLE_THRESHOLD_MS = 100;
const DEFAULT_CALIBRATION_INTERVAL_MS = 10_000;

export type TimerThrottleConfig = {
    /** Target delay for the calibration setTimeout (default: 5ms). */
    calibrationTargetMs? : number;
    /** Delay above which a sample is "throttled" (default: 100ms). */
    throttleThresholdMs? : number;
    /** Samples per calibration round (default: 5; majority decides). */
    calibrationSamples? : number;
    /** How often to recalibrate (default: 10,000ms). */
    calibrationIntervalMs? : number;
};

export class TimerThrottleDetector {
    private throttled = false;
    private running = false;
    private sampleCount = 0;
    private throttledCount = 0;
    private readonly calibrationTargetMs : number;
    private readonly throttleThresholdMs : number;
    private readonly calibrationSamples : number;
    private readonly calibrationIntervalMs : number;

    constructor(
        private readonly setTimeoutFn : SetTimeoutFn,
        private readonly clock : Clock,
        private readonly logger : Logger,
        config : TimerThrottleConfig | number = {},
    ) {
        // Backwards compat: a bare number argument is the calibrationIntervalMs
        const cfg = typeof config === "number"
            ? { calibrationIntervalMs : config }
            : config;
        this.calibrationTargetMs    = cfg.calibrationTargetMs    ?? DEFAULT_CALIBRATION_TARGET_MS;
        this.throttleThresholdMs    = cfg.throttleThresholdMs    ?? DEFAULT_THROTTLE_THRESHOLD_MS;
        this.calibrationSamples     = cfg.calibrationSamples     ?? DEFAULT_CALIBRATION_SAMPLES;
        this.calibrationIntervalMs  = cfg.calibrationIntervalMs  ?? DEFAULT_CALIBRATION_INTERVAL_MS;
    }

    start() : void {
        if (this.running) return;
        this.running = true;
        this.runCalibration();
    }

    stop() : void {
        this.running = false;
    }

    isThrottled() : boolean {
        return this.throttled;
    }

    private runCalibration() : void {
        if (!this.running) return;

        this.sampleCount = 0;
        this.throttledCount = 0;
        this.takeSample();
    }

    private takeSample() : void {
        if (!this.running) return;

        const start = this.clock.now();
        this.setTimeoutFn(() => {
            if (!this.running) return;

            const elapsed = this.clock.now() - start;
            this.sampleCount++;

            if (elapsed > this.throttleThresholdMs) {
                this.throttledCount++;
            }

            if (this.sampleCount < this.calibrationSamples) {
                this.takeSample();
            } else {
                const wasThrottled = this.throttled;
                // Majority of samples exceeded threshold
                this.throttled = this.throttledCount > this.calibrationSamples / 2;

                if (this.throttled && !wasThrottled) {
                    this.logger.log("warn", "Timer throttling detected.", {
                        type : "TimerThrottleDetector",
                        throttledSamples : this.throttledCount,
                        totalSamples : this.sampleCount,
                    });
                } else if (!this.throttled && wasThrottled) {
                    this.logger.log("info", "Timer throttling ended.", {
                        type : "TimerThrottleDetector",
                    });
                }

                // Schedule next calibration
                this.setTimeoutFn(() => this.runCalibration(), this.calibrationIntervalMs);
            }
        }, this.calibrationTargetMs);
    }
}
