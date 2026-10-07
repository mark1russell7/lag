import type { Clock, ClearTimeoutFn, Logger, SetTimeoutFn } from "./types.js";

/**
 * Defaults:
 *
 * - CALIBRATION_TARGET_MS = 5: just above the 4ms clamp browsers apply to
 *   nested timers, so an unthrottled timer fires close to this delay.
 *
 * - THROTTLE_THRESHOLD_MS = 100: browsers throttle background-tab timers to
 *   about once per second (and Chrome's intensive throttling to once per
 *   minute). 100ms sits far above normal jitter and far below either.
 *
 * - CALIBRATION_SAMPLES = 5: smallest odd number where a strict majority
 *   (3 of 5) gives a stable signal without taking too long.
 *
 * - CALIBRATION_INTERVAL_MS = 10_000: long enough to avoid being a
 *   noticeable timer source itself, short enough to detect a throttle
 *   transition within ~10s of it happening.
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

/** The result of one calibration round. */
export type ThrottleCalibration = {
    throttled : boolean;
    throttledSamples : number;
    totalSamples : number;
};

export class TimerThrottleDetector {
    private throttled = false;
    /** The one pending timer (a sample or the wait before the next round); undefined when stopped. */
    private handle : number | undefined;
    private readonly calibrationTargetMs : number;
    private readonly throttleThresholdMs : number;
    private readonly calibrationSamples : number;
    private readonly calibrationIntervalMs : number;

    constructor(
        private readonly report : (calibration : ThrottleCalibration) => void,
        private readonly setTimeoutFn : SetTimeoutFn,
        private readonly clearTimeoutFn : ClearTimeoutFn,
        private readonly clock : Clock,
        private readonly logger : Logger,
        config : TimerThrottleConfig = {},
    ) {
        this.calibrationTargetMs    = config.calibrationTargetMs    ?? DEFAULT_CALIBRATION_TARGET_MS;
        this.throttleThresholdMs    = config.throttleThresholdMs    ?? DEFAULT_THROTTLE_THRESHOLD_MS;
        this.calibrationSamples     = config.calibrationSamples     ?? DEFAULT_CALIBRATION_SAMPLES;
        this.calibrationIntervalMs  = config.calibrationIntervalMs  ?? DEFAULT_CALIBRATION_INTERVAL_MS;
    }

    start() : void {
        if (this.handle !== undefined) return;
        this.takeSample(0, 0);
    }

    stop() : void {
        if (this.handle === undefined) return;
        this.clearTimeoutFn(this.handle);
        this.handle = undefined;
    }

    isThrottled() : boolean {
        return this.throttled;
    }

    private takeSample(sampleCount : number, throttledCount : number) : void {
        const start = this.clock.now();
        const handle : number = this.setTimeoutFn(() => {
            const elapsed = this.clock.now() - start;
            const samples = sampleCount + 1;
            const throttledSamples = throttledCount + (elapsed > this.throttleThresholdMs ? 1 : 0);

            if (samples < this.calibrationSamples) {
                this.takeSample(samples, throttledSamples);
                return;
            }

            const wasThrottled = this.throttled;
            this.throttled = throttledSamples > this.calibrationSamples / 2;
            try {
                this.report({ throttled : this.throttled, throttledSamples, totalSamples : samples });
            } catch (error) {
                this.logger.log("error", "Error reporting timer calibration.", { error, type : "TimerThrottleDetector" });
            }

            if (this.throttled && !wasThrottled) {
                this.logger.log("warn", "Timer throttling detected.", {
                    type : "TimerThrottleDetector",
                    throttledSamples,
                    totalSamples : samples,
                });
            } else if (!this.throttled && wasThrottled) {
                this.logger.log("info", "Timer throttling ended.", {
                    type : "TimerThrottleDetector",
                });
            }

            // report() or the logger may have stopped (or stopped and restarted) the detector
            if (this.handle === handle) {
                this.handle = this.setTimeoutFn(() => this.takeSample(0, 0), this.calibrationIntervalMs);
            }
        }, this.calibrationTargetMs);
        this.handle = handle;
    }
}
