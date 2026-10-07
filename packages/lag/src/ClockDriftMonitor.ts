import type { ClearIntervalFn, Logger, PerformanceLike, SetIntervalFn, WallClock } from "./types.js";

export type ClockDriftSample = {
    /**
     * `Date.now()` minus `performance.timeOrigin + performance.now()`. It is
     * near 0 at page load. Its size shows how far timestamps that use the
     * monotonic clock (for example OpenTelemetry timestamps) are from the wall
     * clock.
     */
    skewMs : number;
    /** The change of the skew since the previous sample. */
    driftMs : number;
};

/**
 * A sudden change of the skew. `forward`: the wall clock moved ahead of the
 * monotonic clock. Causes: a system clock step (NTP or the user), or a sleep
 * on a platform where the monotonic clock stops during sleep (Linux, and some
 * macOS versions). `backward`: the wall clock moved back.
 */
export type ClockJump = {
    direction : "forward" | "backward";
    magnitudeMs : number;
    skewMs : number;
};

const DEFAULT_INTERVAL_MS = 10_000;
const DEFAULT_JUMP_THRESHOLD_MS = 1_000;

/**
 * Compares the wall clock (`Date.now()`) with the monotonic clock
 * (`performance.timeOrigin + performance.now()`) at a fixed interval.
 *
 * There is no browser API that reports clock steps or system sleep. A
 * comparison of the two clocks is the standard method. The monitor does not
 * change measurements that use the monotonic clock: a step of the wall clock
 * does not affect them.
 */
export class ClockDriftMonitor {
    private handle : number | undefined;
    private lastSkew = 0;

    constructor(
        private readonly report : (sample : ClockDriftSample) => void,
        private readonly onJump : (jump : ClockJump) => void,
        private readonly logger : Logger,
        private readonly performance : PerformanceLike,
        private readonly wallClock : WallClock,
        private readonly setIntervalFn : SetIntervalFn,
        private readonly clearIntervalFn : ClearIntervalFn,
        private readonly intervalMs : number = DEFAULT_INTERVAL_MS,
        private readonly jumpThresholdMs : number = DEFAULT_JUMP_THRESHOLD_MS,
    ) {
        this.start();
    }

    start() : void {
        if (this.handle !== undefined) return;
        this.lastSkew = this.readSkew();
        this.handle = this.setIntervalFn(() => this.sample(), this.intervalMs);
    }

    stop() : void {
        if (this.handle === undefined) return;
        this.clearIntervalFn(this.handle);
        this.handle = undefined;
    }

    /** The current skew in milliseconds. */
    getSkewMs() : number {
        return this.readSkew();
    }

    private readSkew() : number {
        return this.wallClock.now() - (this.performance.timeOrigin + this.performance.now());
    }

    private sample() : void {
        try {
            const skewMs = this.readSkew();
            const driftMs = skewMs - this.lastSkew;
            this.lastSkew = skewMs;
            this.report({ skewMs, driftMs });
            if (Math.abs(driftMs) >= this.jumpThresholdMs) {
                this.onJump({
                    direction : driftMs > 0 ? "forward" : "backward",
                    magnitudeMs : Math.abs(driftMs),
                    skewMs,
                });
            }
        } catch (error) {
            this.logger.log("error", "Error in clock drift measurement.", {
                error,
                type : "ClockDriftMonitor",
            });
        }
    }
}
