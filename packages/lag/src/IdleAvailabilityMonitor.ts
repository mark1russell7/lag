import type { Clock, Logger } from "./types.js";

export type IdleDeadline = {
    didTimeout : boolean;
    timeRemaining() : number;
};

export type RequestIdleCallbackFn = (
    callback : (deadline : IdleDeadline) => void,
    options? : { timeout? : number },
) => number;

export type CancelIdleCallbackFn = (handle : number) => void;

export type IdleMeasurement = {
    timeRemainingMs : number;     // ms of idle time available
    timeSinceLastIdleMs : number; // gap since previous idle callback fired
    didTimeout : boolean;         // browser was forced to fire it via timeout
};

const DEFAULT_TIMEOUT_MS = 1000;

/**
 * This monitor measures the idle availability of the main thread through
 * `requestIdleCallback`.
 *
 * This value is the *inverse* of lag. The monitor does not measure how late
 * callbacks fire. It measures how frequently the main thread is really idle,
 * and how much time is available in those idle windows.
 *
 * On a healthy main thread, idle callbacks fire frequently, with a high
 * `timeRemaining()`. On a stressed main thread, the gaps between idle
 * callbacks are long, `timeRemaining()` is low, or `didTimeout` is `true`.
 * `didTimeout` shows that the browser forced the callback, because no idle
 * window came before the timeout.
 */
export class IdleAvailabilityMonitor {
    private handle : number | undefined;
    private started = false;
    private lastIdleFireTime = -1;
    private totalIdleFires = 0;
    private timeoutFires = 0;

    constructor(
        private readonly report : (measurement : IdleMeasurement) => void,
        private readonly logger : Logger,
        private readonly requestIdleCallbackFn : RequestIdleCallbackFn,
        private readonly cancelIdleCallbackFn : CancelIdleCallbackFn,
        private readonly clock : Clock,
        private readonly timeoutMs : number = DEFAULT_TIMEOUT_MS,
    ) {
        this.start();
    }

    start() : void {
        if (this.started) return;
        this.started = true;
        this.scheduleNextIdle();
    }

    stop() : void {
        this.started = false;
        if (this.handle !== undefined) {
            this.cancelIdleCallbackFn(this.handle);
            this.handle = undefined;
        }
        this.lastIdleFireTime = -1;
    }

    getTimeoutRate() : number {
        if (this.totalIdleFires === 0) return 0;
        return this.timeoutFires / this.totalIdleFires;
    }

    resetCounters() : void {
        this.totalIdleFires = 0;
        this.timeoutFires = 0;
    }

    private scheduleNextIdle() : void {
        if (!this.started) return;
        const handle : number = this.requestIdleCallbackFn(
            (deadline) => this.onIdle(deadline, handle),
            { timeout : this.timeoutMs },
        );
        this.handle = handle;
    }

    /** `handle` identifies the chain of this callback, because `report()` can stop or restart the monitor. */
    private onIdle(deadline : IdleDeadline, handle : number) : void {
        if (!this.started || this.handle !== handle) return;

        try {
            const now = this.clock.now();
            const timeSinceLastIdleMs = this.lastIdleFireTime >= 0
                ? now - this.lastIdleFireTime
                : 0;
            // Before report(), so a stop() inside it can reset the baseline
            this.lastIdleFireTime = now;

            this.totalIdleFires++;
            if (deadline.didTimeout) this.timeoutFires++;

            this.report({
                timeRemainingMs : deadline.timeRemaining(),
                timeSinceLastIdleMs,
                didTimeout : deadline.didTimeout,
            });
        } catch (error) {
            this.logger.log("error", "Error in idle measurement.", {
                error,
                type : "IdleAvailabilityMonitor",
            });
        }

        if (this.handle === handle) this.scheduleNextIdle();
    }
}
