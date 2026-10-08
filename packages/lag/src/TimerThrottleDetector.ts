import type { Clock, ClearTimeoutFn, Logger, SetTimeoutFn } from "./types.js";

/**
 * The defaults:
 *
 * - `DEFAULT_CALIBRATION_TARGET_MS = 5`: 1 ms more than the 4 ms clamp that
 *   browsers apply to nested timers. Thus, a timer that is not throttled
 *   fires near this delay.
 * - `DEFAULT_THROTTLE_THRESHOLD_MS = 100`: browsers throttle the timers of a
 *   background tab to approximately one time each second. The intensive
 *   throttling of Chrome is one time each minute. 100 ms is much more than
 *   usual jitter and much less than the two throttle intervals.
 * - `DEFAULT_CALIBRATION_SAMPLES = 5`: the smallest odd number at which a
 *   strict majority (3 of 5) gives a stable signal, and a round is not too
 *   long.
 * - `DEFAULT_CALIBRATION_INTERVAL_MS = 10_000`: the interval is long enough
 *   that the detector is not a noticeable timer source. It is short enough
 *   to find a change of the throttle state in approximately 10 s.
 */
const DEFAULT_CALIBRATION_TARGET_MS = 5;
const DEFAULT_CALIBRATION_SAMPLES = 5;
const DEFAULT_THROTTLE_THRESHOLD_MS = 100;
const DEFAULT_CALIBRATION_INTERVAL_MS = 10_000;

export type TimerThrottleConfig = {
    /** The target delay of the calibration `setTimeout`. The default is 5 ms. */
    calibrationTargetMs? : number;
    /** A sample with a longer delay than this value is throttled. The default is 100 ms. */
    throttleThresholdMs? : number;
    /** The number of samples in each calibration round. The majority decides. The default is 5. */
    calibrationSamples? : number;
    /** The wait between the end of a calibration round and the next round. The default is 10,000 ms. */
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
    /** The one pending timer: a sample, or the wait before the next round. It is `undefined` when the detector is stopped. */
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
