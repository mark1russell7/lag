import type { Clock, Logger, SetTimeoutFn } from "./types.js";

const CALIBRATION_TARGET_MS = 5;
const CALIBRATION_SAMPLES = 5;
const THROTTLE_THRESHOLD_MS = 100;

export class TimerThrottleDetector {
    private throttled = false;
    private running = false;
    private sampleCount = 0;
    private throttledCount = 0;

    constructor(
        private readonly setTimeoutFn : SetTimeoutFn,
        private readonly clock : Clock,
        private readonly logger : Logger,
        private readonly calibrationIntervalMs = 10_000,
    ) {}

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

            if (elapsed > THROTTLE_THRESHOLD_MS) {
                this.throttledCount++;
            }

            if (this.sampleCount < CALIBRATION_SAMPLES) {
                this.takeSample();
            } else {
                const wasThrottled = this.throttled;
                // Majority of samples exceeded threshold
                this.throttled = this.throttledCount > CALIBRATION_SAMPLES / 2;

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
        }, CALIBRATION_TARGET_MS);
    }
}
