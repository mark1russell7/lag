/** A task of the simulated thread. */
type Task = { readyAt : number; order : number; run : () => void };

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
    /** The number of messages that the thread got since it started. */
    postedMessages = 0;
    readonly clock = { now : () : number => this.now };

    private nextId = 1;
    private order = 0;
    /** The time at which the thread became busy after an idle period. */
    private busySince = 0;
    private readonly timers = new Map<number, Task>();
    private readonly messages : Task[] = [];

    constructor(private readonly taskCostMs = 0.01) {}

    readonly setTimeout = (run : () => void, ms : number) : number => {
        const id = this.nextId++;
        this.timers.set(id, { readyAt : this.now + Math.max(0, ms) + this.timerExtraMs, order : this.order++, run });
        return id;
    };

    readonly clearTimeout = (id : number) : void => {
        this.timers.delete(id);
    };

    readonly setInterval = (run : () => void, ms : number) : number => {
        const id = this.nextId++;
        const repeat = () : void => {
            this.timers.set(id, { readyAt : this.now + Math.max(1, ms), order : this.order++, run : () => { repeat(); run(); } });
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
            next.task.run();
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
