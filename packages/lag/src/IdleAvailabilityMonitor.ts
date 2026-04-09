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
 * Measures main thread idle availability via requestIdleCallback.
 *
 * This is the *inverse* of lag: instead of measuring how late callbacks fire,
 * it measures how often the main thread is genuinely idle and how much time
 * is available during those idle windows.
 *
 * Healthy main thread: idle callbacks fire frequently with high timeRemaining().
 * Stressed main thread: long gaps between idle fires, low timeRemaining(), or
 * `didTimeout=true` (meaning the browser had to force the callback because no
 * idle window appeared within the timeout).
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
        this.handle = this.requestIdleCallbackFn(
            (deadline) => this.onIdle(deadline),
            { timeout : this.timeoutMs },
        );
    }

    private onIdle(deadline : IdleDeadline) : void {
        if (!this.started) return;

        try {
            const now = this.clock.now();
            const timeSinceLastIdleMs = this.lastIdleFireTime >= 0
                ? now - this.lastIdleFireTime
                : 0;

            this.totalIdleFires++;
            if (deadline.didTimeout) this.timeoutFires++;

            this.report({
                timeRemainingMs : deadline.timeRemaining(),
                timeSinceLastIdleMs,
                didTimeout : deadline.didTimeout,
            });

            this.lastIdleFireTime = now;
        } catch (error) {
            this.logger.log("error", "Error in idle measurement.", {
                error,
                type : "IdleAvailabilityMonitor",
            });
        }

        this.scheduleNextIdle();
    }
}
