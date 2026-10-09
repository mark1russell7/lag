import type { Clock, Logger, SetIntervalFn, ClearIntervalFn, SetTimeoutFn } from "./types.js";
import { createMessageTaskQueue, type MessageTaskQueue } from "./message-task.js";

// Duck-typed MessageChannel — no DOM lib dependency
export type MessageChannelLike = {
    port1 : MessagePortLike;
    port2 : MessagePortLike;
};

export type MessagePortLike = {
    postMessage(data : unknown) : void;
    /**
     * The monitor does not read the event. The type `never` lets the real
     * `MessagePort` fit, because its handler takes a `MessageEvent`.
     */
    onmessage : ((event : never) => void) | null;
    start? : () => void;
    close? : () => void;
};

export type MessageChannelConstructor = new () => MessageChannelLike;

export type QueueMicrotaskFn = (callback : () => void) => void;

export type SchedulingMeasurement = {
    macrotaskMs : number;        // setTimeout(0) latency
    microtaskMs : number;        // queueMicrotask latency
    messageChannelMs : number;   // MessageChannel.postMessage latency
};

/**
 * This monitor measures the time that three scheduling primitives take to
 * start a callback. The monitor queues the three callbacks at the same
 * instant:
 *
 * - **Macrotask** (`setTimeout(0)`): the callback waits behind all queued
 *   tasks.
 * - **MessageChannel** (`port.postMessage`): the callback is also a task,
 *   but without the timer rules. It gives the most direct view of the delay
 *   of the task queue.
 * - **Microtask** (`queueMicrotask`): the callback starts immediately after
 *   the measuring task ends. Thus, it measures only the remainder of that
 *   task, and the value stays near 0. It is a zero baseline, not a signal of
 *   its own, because other tasks cannot starve a microtask.
 *
 * Each cycle starts in a message task (`createMessageTaskQueue`), not in the
 * `setInterval` callback. In a message task, the timer nesting level is 0.
 * Thus, the browser does not clamp the `setTimeout(0)` to 4 ms.
 *
 * The two task latencies increase when the task queue fills.
 */
export class SchedulingFairnessMonitor {
    private handle : number | undefined;
    private tasks : MessageTaskQueue | undefined;
    private started = false;
    /**
     * `start()` increments this value. A cycle that started before a stop
     * and a new start must not report.
     */
    private generation = 0;

    constructor(
        private readonly intervalMs : number,
        private readonly report : (measurement : SchedulingMeasurement) => void,
        private readonly logger : Logger,
        private readonly setIntervalFn : SetIntervalFn,
        private readonly clearIntervalFn : ClearIntervalFn,
        private readonly setTimeoutFn : SetTimeoutFn,
        private readonly queueMicrotaskFn : QueueMicrotaskFn,
        private readonly MessageChannelCtor : MessageChannelConstructor,
        private readonly clock : Clock,
    ) {
        this.start();
    }

    start() : void {
        if (this.started) return;
        let tasks : MessageTaskQueue;
        try {
            tasks = createMessageTaskQueue(this.MessageChannelCtor);
        } catch (error) {
            this.logError(error);
            return;
        }
        this.tasks = tasks;
        this.started = true;
        this.generation++;
        this.handle = this.setIntervalFn(() => tasks.post(() => this.measureCycle()), this.intervalMs);
    }

    stop() : void {
        this.started = false;
        if (this.handle !== undefined) {
            this.clearIntervalFn(this.handle);
            this.handle = undefined;
        }
        this.tasks?.close();
        this.tasks = undefined;
    }

    private measureCycle() : void {
        const tasks = this.tasks;
        if (!tasks) return;
        try {
            // Three independent measurements per cycle, fired simultaneously.
            // We capture the start time once and let each scheduling primitive
            // report when it eventually fires.
            const start = this.clock.now();
            const generation = this.generation;
            const result : Partial<SchedulingMeasurement> = {};

            // The callbacks of the three primitives start outside this try/catch
            const checkComplete = () : void => {
                if (
                    this.started &&
                    generation === this.generation &&
                    result.macrotaskMs !== undefined &&
                    result.microtaskMs !== undefined &&
                    result.messageChannelMs !== undefined
                ) {
                    try {
                        this.report(result as SchedulingMeasurement);
                    } catch (error) {
                        this.logError(error);
                    }
                }
            };

            // Macrotask via setTimeout(0)
            this.setTimeoutFn(() => {
                result.macrotaskMs = this.clock.now() - start;
                checkComplete();
            }, 0);

            // Microtask via queueMicrotask
            this.queueMicrotaskFn(() => {
                result.microtaskMs = this.clock.now() - start;
                checkComplete();
            });

            // A message task
            tasks.post(() => {
                result.messageChannelMs = this.clock.now() - start;
                checkComplete();
            });
        } catch (error) {
            this.logError(error);
        }
    }

    private logError(error : unknown) : void {
        this.logger.log("error", "Error in scheduling fairness measurement.", {
            error,
            type : "SchedulingFairnessMonitor",
        });
    }
}
