import type { PostTaskFn } from "./message-task.js";
import type { Clock } from "./types.js";

/**
 * A message that waits longer than this value shows that the main thread was
 * busy. In Firefox and WebKit, `performance.now()` of a page without
 * cross-origin isolation moves in steps of 1 ms. Thus, a short wait can
 * read as 2 ms.
 */
const BUSY_WAIT_MS = 2;

/** A thread that starts each message in this time is free for a timer that is due. */
const FREE_WAIT_MS = 8;

/** A free stretch counts from this time after the start of the measurement: the longest step of a timer granularity. */
const FREE_FROM_MS = 40;

/** A free stretch has this length. */
const FREE_STRETCH_MS = 10;

/**
 * This probe measures the busy time of the main thread during an interval,
 * with a chain of message tasks. Each message posts the next message when it
 * starts. On an idle thread, a message starts at once. On a busy thread, it
 * waits until the current task ends. The busy time is the sum of the waits
 * that are longer than 2 ms.
 *
 * A message does not wait for a timer, thus the timer granularity does not
 * change the result. The chain keeps the thread awake, thus a probe must
 * operate only for a short interval, for example for one timer step. A
 * limit (`start(limitMs)`) stops the chain after that time. A second limit
 * (`start(limitMs, freeLimitMs)`) lets the chain go on until it finds a free
 * stretch of the thread (`foundFreeStretch`).
 *
 * A timer can start earlier while the thread is awake. In Chromium, a timer
 * step of 5 ms took 0.7 ms less during a probe, and 2.5 ms less one time.
 * Thus the duration of a probed step is not an idle duration.
 */
export class BusyTimeProbe {
    private running = false;
    /** The number of the last message. A message of an earlier measurement does nothing. */
    private sequence = 0;
    private postedAt = 0;
    private busyMs = 0;
    private startedAt = 0;
    private limitMs = Infinity;
    /** The chain goes on until this time, if it found no free stretch. */
    private freeLimitMs = 0;
    /** The start of the messages in a row that did not wait. */
    private freeSince : number | undefined;
    private freeStretch = false;
    /** True while a message of the measurement waits or operates. */
    private inFlight = false;

    constructor(
        private readonly postTask : PostTaskFn,
        private readonly clock : Clock,
    ) {}

    /** True from `start()` until `stop()`. */
    isRunning() : boolean {
        return this.running;
    }

    /**
     * This method starts a new measurement. It ends a measurement that
     * operates. With `limitMs`, a message that starts after this time posts
     * no next message. Thus the chain operates only at the start of the
     * interval. A message that waits at the limit still counts its full wait.
     */
    start(limitMs : number = Infinity, freeLimitMs : number = 0) : void {
        this.running = true;
        this.busyMs = 0;
        this.startedAt = this.clock.now();
        this.limitMs = limitMs;
        this.freeLimitMs = freeLimitMs;
        this.freeSince = undefined;
        this.freeStretch = false;
        this.post();
    }

    /**
     * This method stops the measurement, and gives the busy time since
     * `start()`. The wait of the message that did not start counts too.
     * Without a measurement, the value is 0.
     */
    stop() : number {
        if (!this.running) return 0;
        this.running = false;
        this.sequence++;
        if (this.inFlight) this.addWait(this.clock.now() - this.postedAt);
        return this.busyMs;
    }

    private post() : void {
        const id = ++this.sequence;
        this.postedAt = this.clock.now();
        this.inFlight = true;
        this.postTask(() => {
            if (id !== this.sequence) return;
            this.inFlight = false;
            const now = this.clock.now();
            this.addWait(now - this.postedAt);
            this.followFree(now);
            if (now - this.startedAt < (this.freeStretch ? this.limitMs : Math.max(this.limitMs, this.freeLimitMs))) this.post();
        });
    }

    /** This method looks for a free stretch: messages that start at once, after a timer of any granularity is due. */
    private followFree(now : number) : void {
        const waitMs = now - this.postedAt;
        if (waitMs > FREE_WAIT_MS) {
            this.freeSince = now;
        } else {
            this.freeSince ??= this.postedAt;
        }
        if (now - Math.max(this.freeSince, this.startedAt + FREE_FROM_MS) >= FREE_STRETCH_MS) this.freeStretch = true;
    }

    /**
     * This method tells if the thread was free during the measurement, after a timer of any granularity was due.
     * A timer that did not start in that time waits for something other than the thread.
     */
    foundFreeStretch() : boolean {
        return this.freeStretch;
    }

    private addWait(waitMs : number) : void {
        if (waitMs > BUSY_WAIT_MS) this.busyMs += waitMs;
    }
}
