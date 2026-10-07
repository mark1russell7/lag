import type { AbsoluteClock } from "./absolute-clock.js";
import type { ClearIntervalFn, Logger, SetIntervalFn, WallClock } from "./types.js";

export type ClockDriftSample = {
    /**
     * `Date.now()` minus the absolute monotonic time (`timeOrigin` from the
     * start plus `performance.now()`). It is near 0 at the load of the page.
     * It shows how far a timestamp from the monotonic clock is from the wall
     * clock.
     */
    skewMs : number;
    /** The change of the skew since the previous sample. */
    driftMs : number;
    /** The monotonic time since the previous sample. */
    intervalMs : number;
};

/**
 * A discontinuity of the skew. The monitor classifies it:
 * - `suspend`: the wall clock moved forward by 1 s or more. The monotonic
 *   clock stopped while the device slept, as on macOS, Linux, Android and
 *   iOS. A forward step of the system clock of 1 s or more looks the same.
 *   The lateness of the timer has no effect on the classification. In a
 *   hidden page, the browser can delay the timer by a minute. Also, the
 *   device usually sleeps while the page is hidden.
 * - `step`: all other discontinuities, for example a change of the system
 *   clock by NTP or by the user. A backward change is always a step.
 *
 * On Windows, the monotonic clock continues during sleep. A sleep there
 * causes no discontinuity: every timer is late instead. The worker monitor
 * finds that case.
 */
export type ClockJump = {
    direction : "forward" | "backward";
    kind : "suspend" | "step";
    magnitudeMs : number;
    skewMs : number;
    /** How late the timer of the monitor was at this sample. */
    latenessMs : number;
    /** The monotonic time since the previous sample. The discontinuity occurred in this interval. */
    intervalMs : number;
};

export type ClockDriftOptions = {
    /** The time between samples. The default is 1000 ms. */
    intervalMs? : number;
    /** The smallest change of the skew that is a discontinuity. The default is 50 ms. */
    minJumpMs? : number;
    /**
     * The smallest change of the skew, as a fraction of the time between the
     * samples, that is a discontinuity. The default is 0.03. This tolerance
     * lets the operating system correct the wall clock gradually.
     */
    jumpRate? : number;
    /** The smallest forward change that can be a suspend. The default is 1000 ms. */
    suspendMinMs? : number;
};

/**
 * A reading in which the two reads of the monotonic clock are farther apart
 * than this is not accurate: the thread stopped between the reads.
 */
const MAX_READ_SPREAD_MS = 1;

type Reading = { skew : number; monotonic : number };

/**
 * This monitor compares the wall clock (`Date.now()`) with the absolute
 * monotonic clock at a fixed interval, and it finds discontinuities.
 *
 * No browser API reports clock steps or system sleep. The comparison of the
 * two clocks is the standard method (the suspend detector of Chromium and
 * Sentry also use it). For each sample, the monitor reads the monotonic
 * clock before and after the wall clock. It ignores the sample when the two
 * reads are far apart. The threshold of a discontinuity is max(50 ms, 3% of
 * the interval), because operating systems correct the wall clock
 * gradually.
 *
 * The monitor does not change measurements that use the monotonic clock: a
 * change of the wall clock does not affect them.
 */
export class ClockDriftMonitor {
    private handle : number | undefined;
    private last : Reading | undefined;
    private readonly intervalMs : number;
    private readonly minJumpMs : number;
    private readonly jumpRate : number;
    private readonly suspendMinMs : number;

    constructor(
        private readonly report : (sample : ClockDriftSample) => void,
        private readonly onJump : (jump : ClockJump) => void,
        private readonly logger : Logger,
        private readonly clock : AbsoluteClock,
        private readonly wallClock : WallClock,
        private readonly setIntervalFn : SetIntervalFn,
        private readonly clearIntervalFn : ClearIntervalFn,
        options : ClockDriftOptions = {},
    ) {
        this.intervalMs = options.intervalMs ?? 1_000;
        this.minJumpMs = options.minJumpMs ?? 50;
        this.jumpRate = options.jumpRate ?? 0.03;
        this.suspendMinMs = options.suspendMinMs ?? 1_000;
        this.start();
    }

    start() : void {
        if (this.handle !== undefined) return;
        this.last = this.read();
        this.handle = this.setIntervalFn(() => this.sample(), this.intervalMs);
    }

    stop() : void {
        if (this.handle === undefined) return;
        this.clearIntervalFn(this.handle);
        this.handle = undefined;
    }

    /** The current skew in milliseconds. */
    getSkewMs() : number {
        return this.wallClock.now() - this.clock.now();
    }

    private read() : Reading | undefined {
        const before = this.clock.now();
        const wall = this.wallClock.now();
        const after = this.clock.now();
        if (after - before > MAX_READ_SPREAD_MS) return undefined;
        const middle = (before + after) / 2;
        return { skew : wall - middle, monotonic : middle - this.clock.origin };
    }

    private sample() : void {
        try {
            const reading = this.read();
            if (!reading) return;
            const last = this.last;
            this.last = reading;
            if (!last) return;

            const intervalMs = reading.monotonic - last.monotonic;
            const driftMs = reading.skew - last.skew;
            this.report({ skewMs : reading.skew, driftMs, intervalMs });

            if (Math.abs(driftMs) <= Math.max(this.minJumpMs, this.jumpRate * intervalMs)) return;
            this.onJump({
                direction : driftMs > 0 ? "forward" : "backward",
                kind : driftMs >= this.suspendMinMs ? "suspend" : "step",
                magnitudeMs : Math.abs(driftMs),
                skewMs : reading.skew,
                latenessMs : Math.max(0, intervalMs - this.intervalMs),
                intervalMs,
            });
        } catch (error) {
            this.logger.log("error", "Error in clock drift measurement.", {
                error,
                type : "ClockDriftMonitor",
            });
        }
    }
}
