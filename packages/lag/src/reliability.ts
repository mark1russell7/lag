import type { Clock } from "./types.js";

/**
 * Why measurements taken during an interval are not valid:
 * - `hidden`: the page was hidden; browsers throttle timers and stop rAF.
 * - `frozen`: the page was frozen or in the back/forward cache.
 * - `suspend`: the system or the browser process stopped (for example, the
 *   device slept) while the monotonic clock continued.
 */
export type UnreliableReason = "hidden" | "frozen" | "suspend";

/** A period of monotonic time (the `Clock` time base) with invalid measurements. */
export type UnreliableInterval = {
    start : number;
    /** `Infinity` while the interval is open. */
    end : number;
    reason : UnreliableReason;
};

/** How long to keep closed intervals. Late evidence must arrive in this time. */
const DEFAULT_RETENTION_MS = 120_000;

/**
 * Collects the intervals in which measurements are not valid, from all
 * sources of evidence: the page lifecycle, the worker (system suspend), and
 * other monitors. Monitors ask whether their measurement window overlaps one
 * of the intervals.
 *
 * Evidence can arrive after the measurement that it invalidates (for example,
 * the worker reports a suspend after the main thread wakes up). For this
 * reason, the tracker keeps closed intervals for `retentionMs`.
 */
export class ReliabilityTracker {
    private readonly intervals : UnreliableInterval[] = [];
    private readonly listeners = new Set<(interval : UnreliableInterval) => void>();

    constructor(
        private readonly clock : Clock,
        private readonly retentionMs : number = DEFAULT_RETENTION_MS,
    ) {}

    /** Opens an interval that starts now. Call the returned function to close it. */
    open(reason : UnreliableReason) : () => void {
        const interval : UnreliableInterval = { start : this.clock.now(), end : Infinity, reason };
        this.intervals.push(interval);
        this.notify(interval);
        return () => {
            if (interval.end === Infinity) interval.end = this.clock.now();
        };
    }

    /** Adds a closed interval, for example a suspend that the worker detected after the fact. */
    add(start : number, end : number, reason : UnreliableReason) : void {
        if (end < start) return;
        const interval = { start, end, reason };
        this.intervals.push(interval);
        this.notify(interval);
    }

    /**
     * The first interval that overlaps the window from `start` to `end`, or
     * `undefined`. A closed interval that only touches the window at one point
     * does not overlap it: a monitor that starts again when the page becomes
     * visible starts its window when the hidden interval ends. An open
     * interval overlaps every window that ends after it starts.
     */
    findOverlap(start : number, end : number) : UnreliableInterval | undefined {
        this.prune();
        return this.intervals.find(i =>
            i.end === Infinity ? i.start <= end : i.start < end && i.end > start);
    }

    /** True if an interval is open now. */
    isUnreliableNow() : boolean {
        return this.intervals.some(i => i.end === Infinity);
    }

    /** Calls `listener` for each new interval. Returns the function that removes the listener. */
    subscribe(listener : (interval : UnreliableInterval) => void) : () => void {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }

    /** The number of intervals in memory (for tests). */
    getIntervalCount() : number {
        this.prune();
        return this.intervals.length;
    }

    private notify(interval : UnreliableInterval) : void {
        for (const listener of this.listeners) listener(interval);
    }

    private prune() : void {
        const oldest = this.clock.now() - this.retentionMs;
        for (let i = this.intervals.length - 1; i >= 0; i--) {
            if (this.intervals[i]!.end < oldest) this.intervals.splice(i, 1);
        }
    }
}
