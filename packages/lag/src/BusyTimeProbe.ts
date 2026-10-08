import type { PostTaskFn } from "./message-task.js";
import type { Clock } from "./types.js";

/**
 * A message that waits longer than this value shows that the main thread was
 * busy. In Firefox and WebKit, `performance.now()` of a page without
 * cross-origin isolation moves in steps of 1 ms. Thus, a short wait can
 * read as 2 ms.
 */
const BUSY_WAIT_MS = 2;

/**
 * This probe measures the busy time of the main thread during an interval,
 * with a chain of message tasks. Each message posts the next message when it
 * starts. On an idle thread, a message starts at once. On a busy thread, it
 * waits until the current task ends. The busy time is the sum of the waits
 * that are longer than 2 ms.
 *
 * A message does not wait for a timer, thus the timer granularity does not
 * change the result. The chain keeps the thread awake, thus a probe must
 * operate only for a short interval, for example for one timer step. Also,
 * a timer can start earlier while the thread is awake. In Chromium, a timer
 * step of 5 ms took 0.7 ms less during a probe, and 2.5 ms less one time.
 * Thus the duration of a probed step is not an idle duration.
 */
export class BusyTimeProbe {
    private running = false;
    /** The number of the last message. A message of an earlier measurement does nothing. */
    private sequence = 0;
    private postedAt = 0;
    private busyMs = 0;

    constructor(
        private readonly postTask : PostTaskFn,
        private readonly clock : Clock,
    ) {}

    /** True from `start()` until `stop()`. */
    isRunning() : boolean {
        return this.running;
    }

    /** This method starts a new measurement. It ends a measurement that operates. */
    start() : void {
        this.running = true;
        this.busyMs = 0;
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
        this.addWait(this.clock.now() - this.postedAt);
        return this.busyMs;
    }

    private post() : void {
        const id = ++this.sequence;
        this.postedAt = this.clock.now();
        this.postTask(() => {
            if (id !== this.sequence) return;
            this.addWait(this.clock.now() - this.postedAt);
            this.post();
        });
    }

    private addWait(waitMs : number) : void {
        if (waitMs > BUSY_WAIT_MS) this.busyMs += waitMs;
    }
}
