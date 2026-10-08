/** A task of the simulated thread. A timer task has the nesting level of its timer. */
type Task = { readyAt : number; order : number; run : () => void; nesting? : number };

/**
 * The nesting levels of WebKit (`DOMTimer.cpp`). A one-shot timer reached
 * the maximum at level 10, and a repeating timer at level 5. The level of a
 * timer is the level of the timer task that made it, plus 1, and 0 outside
 * a timer task.
 */
const MAX_NESTING_LEVEL = 10;
const MAX_NESTING_LEVEL_FOR_REPEATING_TIMERS = 5;

/**
 * A simulated main thread for the tests of the timer monitors. It has a
 * virtual clock, a timer queue and a message queue, as a browser has.
 *
 * The thread does one task at a time. It starts the tasks in the sequence in
 * which they became ready: a timer at its due time, a message when it was
 * posted. Thus, a timer that becomes due during a long task starts before a
 * message that the task posts at its end. A task can keep the thread busy
 * with `busy(ms)`. Each task takes at least `taskCostMs`, thus the clock
 * moves also during a chain of messages.
 */
export class SimulatedThread {
    /** The time of the virtual clock, in milliseconds. */
    now = 0;
    /** The extra delay of each timer, for example from the timer granularity of the system. */
    timerExtraMs = 0;
    /**
     * The extra delay of a timer that becomes due while the thread is idle.
     * A thread that operates at the due time starts the timer at once. Thus,
     * a probe that keeps the thread awake makes a timer step shorter, as in
     * Chromium.
     */
    idleTimerWakeMs = 0;
    /**
     * The extra delay of a timer that becomes due while the thread is idle.
     * It applies after the thread operated for 2 ms or more without an idle
     * period. In Chromium, the step after a probe took 11 ms instead of 8 ms.
     */
    lateWakeAfterAwakeMs = 0;
    /** The delay of each message after it was posted, also on an idle thread, as in WebKit for Windows. */
    messageDelayMs = 0;
    /**
     * The alignment of the timers that reached the maximum nesting level, as
     * in WebKit (`ScriptExecutionContext::alignedFireTime`). WebKit aligns
     * them to 4 ms, and to 30 ms in Low Power Mode or with thermal
     * mitigation. The value 0 aligns nothing.
     */
    nestedTimerAlignmentMs = 0;
    /** The random offset of the alignment, as a part of the alignment interval (WebKit: `randomizedProportion`). */
    alignmentOffset = 0.37;
    /** The number of messages that the thread got since it started. */
    postedMessages = 0;
    readonly clock = { now : () : number => this.now };

    private nextId = 1;
    private order = 0;
    /** The time at which the thread became busy after an idle period. */
    private busySince = 0;
    private readonly timers = new Map<number, Task>();
    private readonly messages : Task[] = [];
    /** The nesting level of the context: for a timer task, the level of its timer plus 1. Otherwise 0. */
    private nesting = 0;

    constructor(private readonly taskCostMs = 0.01) {}

    readonly setTimeout = (run : () => void, ms : number) : number => {
        const id = this.nextId++;
        const nesting = this.nesting;
        const readyAt = this.now + Math.max(0, ms) + this.timerExtraMs;
        this.timers.set(id, { readyAt : this.aligned(readyAt, nesting >= MAX_NESTING_LEVEL), order : this.order++, run, nesting });
        return id;
    };

    /**
     * The fire time of WebKit for a timer: the next boundary of the
     * alignment interval after the time. A time on a boundary also moves to
     * the next boundary. The boundaries have a random offset.
     */
    private aligned(fireTime : number, reachedMaxNesting : boolean) : number {
        const interval = this.nestedTimerAlignmentMs;
        if (interval === 0 || !reachedMaxNesting) return fireTime;
        const offset = interval * this.alignmentOffset;
        const adjusted = fireTime - offset;
        return adjusted - (adjusted % interval) + interval + offset;
    }

    readonly clearTimeout = (id : number) : void => {
        this.timers.delete(id);
    };

    readonly setInterval = (run : () => void, ms : number) : number => {
        const id = this.nextId++;
        // Each repeat increases the nesting level of the interval
        let nesting = this.nesting;
        const repeat = () : void => {
            const readyAt = this.aligned(this.now + Math.max(1, ms), nesting >= MAX_NESTING_LEVEL_FOR_REPEATING_TIMERS);
            this.timers.set(id, { readyAt, order : this.order++, run : () => { nesting = Math.min(nesting + 1, MAX_NESTING_LEVEL); repeat(); run(); }, nesting });
        };
        repeat();
        return id;
    };

    readonly clearInterval = (id : number) : void => {
        this.timers.delete(id);
    };

    /** This function starts `run` in a new message task. */
    readonly post = (run : () => void) : void => {
        this.postedMessages++;
        this.messages.push({ readyAt : this.now + this.messageDelayMs, order : this.order++, run });
    };

    /** In a task: the task keeps the thread busy for `ms`. */
    busy(ms : number) : void {
        this.now += ms;
    }

    /** This method starts the tasks of the next `ms` of virtual time. */
    advance(ms : number) : void {
        this.runUntil(this.now + ms);
    }

    /** This method starts each task that is ready before `time`, and then moves the clock to `time`. */
    runUntil(time : number) : void {
        for (;;) {
            const next = this.nextTask();
            if (!next) break;
            // The thread is idle until the task is ready
            const idle = next.task.readyAt > this.now;
            let startAt = Math.max(this.now, next.task.readyAt);
            if (idle && next.timerId !== undefined) {
                startAt += this.idleTimerWakeMs;
                if (this.now - this.busySince >= 2) startAt += this.lateWakeAfterAwakeMs;
            }
            if (startAt > time) break;
            if (idle) this.busySince = startAt;
            if (next.timerId === undefined) this.messages.shift();
            else this.timers.delete(next.timerId);
            this.now = startAt;
            this.nesting = next.task.nesting === undefined ? 0 : Math.min(next.task.nesting + 1, MAX_NESTING_LEVEL);
            next.task.run();
            this.nesting = 0;
            this.now += this.taskCostMs;
        }
        this.now = Math.max(this.now, time);
    }

    /**
     * This method starts a load of equal tasks of `taskMs` until `endAt`. A
     * message starts the next task, or a timer with `gapMs` if `gapMs` is set.
     */
    load(taskMs : number, endAt : number, gapMs? : number) : void {
        const next = () : void => {
            this.busy(taskMs);
            if (this.now >= endAt) return;
            if (gapMs === undefined) this.post(next);
            else this.setTimeout(next, gapMs);
        };
        this.post(next);
    }

    private nextTask() : { task : Task; timerId? : number } | undefined {
        let next : { task : Task; timerId? : number } | undefined = this.messages[0] ? { task : this.messages[0] } : undefined;
        for (const [timerId, task] of this.timers) {
            if (!next || task.readyAt < next.task.readyAt || (task.readyAt === next.task.readyAt && task.order < next.task.order)) {
                next = { task, timerId };
            }
        }
        return next;
    }
}
