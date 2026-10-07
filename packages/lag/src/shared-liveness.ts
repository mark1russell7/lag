import type { Clock, ClearIntervalFn, SetIntervalFn, SetTimeoutFn } from "./types.js";

/**
 * Shared-memory liveness: the main thread increments a counter in a
 * `SharedArrayBuffer` while it runs, and a worker reads the counter at a
 * short interval. A counter that does not change for longer than a threshold
 * shows a main-thread block, measured from outside the main thread while it
 * happens, with no messages.
 *
 * `SharedArrayBuffer` requires cross-origin isolation (COOP and COEP
 * headers). The worker compares counter values only, so the two clocks do not
 * have to agree.
 */

/** The buffer size: one 32-bit counter. */
export const LIVENESS_BUFFER_BYTES = 4;

export type LivenessBeacon = {
    /** Call this from main-thread callbacks that run often. */
    beat() : void;
};

export function createLivenessBeacon(buffer : SharedArrayBuffer) : LivenessBeacon {
    const counter = new Int32Array(buffer);
    return { beat : () => { Atomics.add(counter, 0, 1); } };
}

/**
 * Returns a `setTimeout` replacement whose callbacks beat before they run.
 * Give it to a monitor that schedules short timers (DriftLag schedules one
 * every 5 ms), so the monitor does not need to know about the beacon.
 */
export function beatingSetTimeout(setTimeoutFn : SetTimeoutFn, beacon : LivenessBeacon) : SetTimeoutFn {
    return (handler, timeout) => setTimeoutFn(() => {
        beacon.beat();
        handler();
    }, timeout);
}

/** A main-thread block that the watcher saw. Times are the watcher's clock. */
export type LivenessBlock = {
    startedAt : number;
    durationMs : number;
};

export type LivenessWatcherOptions = {
    /** A counter that does not change for this long is a block. Default: 50ms. */
    thresholdMs? : number;
    /** How often the watcher reads the counter. Default: 5ms. */
    pollIntervalMs? : number;
};

const DEFAULT_THRESHOLD_MS = 50;
const DEFAULT_POLL_INTERVAL_MS = 5;

/**
 * The worker side: reads the counter at `pollIntervalMs` and reports each
 * block when the counter changes again. The duration is the time from the
 * last change before the block to the first change after it.
 *
 * The watcher cannot tell a block from a main thread that has no timers to
 * run. Start it only while a frequent beat (for example DriftLag) runs, and
 * stop it while the page is hidden.
 */
export class LivenessWatcher {
    private handle : number | undefined;
    private lastValue = 0;
    private lastChangeAt = 0;
    private lastPollAt = 0;
    private readonly counter : Int32Array;
    private readonly thresholdMs : number;
    private readonly pollIntervalMs : number;

    constructor(
        buffer : SharedArrayBuffer,
        private readonly onBlock : (block : LivenessBlock) => void,
        private readonly clock : Clock,
        private readonly setIntervalFn : SetIntervalFn,
        private readonly clearIntervalFn : ClearIntervalFn,
        options : LivenessWatcherOptions = {},
    ) {
        this.counter = new Int32Array(buffer);
        this.thresholdMs = options.thresholdMs ?? DEFAULT_THRESHOLD_MS;
        this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    }

    start() : void {
        if (this.handle !== undefined) return;
        this.lastValue = Atomics.load(this.counter, 0);
        this.lastChangeAt = this.clock.now();
        this.lastPollAt = this.lastChangeAt;
        this.handle = this.setIntervalFn(() => this.poll(), this.pollIntervalMs);
    }

    stop() : void {
        if (this.handle === undefined) return;
        this.clearIntervalFn(this.handle);
        this.handle = undefined;
    }

    private poll() : void {
        const value = Atomics.load(this.counter, 0);
        const now = this.clock.now();
        const lateMs = now - this.lastPollAt - this.pollIntervalMs;
        this.lastPollAt = now;
        // The watcher itself did not run (for example, the system slept): do not blame the main thread
        if (lateMs >= this.thresholdMs) {
            this.lastValue = value;
            this.lastChangeAt = now;
            return;
        }
        if (value === this.lastValue) return;
        const quietMs = now - this.lastChangeAt;
        if (quietMs >= this.thresholdMs) {
            this.onBlock({ startedAt : this.lastChangeAt, durationMs : quietMs });
        }
        this.lastValue = value;
        this.lastChangeAt = now;
    }
}
