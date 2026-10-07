import type { Clock, Logger, SetIntervalFn, ClearIntervalFn, SetTimeoutFn } from "./types.js";

// Duck-typed MessageChannel — no DOM lib dependency
export type MessageChannelLike = {
    port1 : MessagePortLike;
    port2 : MessagePortLike;
};

export type MessagePortLike = {
    postMessage(data : unknown) : void;
    /** The monitor never reads the event; `never` lets the real `MessagePort` (whose handler takes a MessageEvent) fit. */
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
 * Measures how long three scheduling primitives take to run a callback queued
 * at the same instant:
 *
 * - **Macrotask** (`setTimeout(0)`): waits behind every queued task. Clamped
 *   to ≥4ms once timers nest (setInterval callbacks count as nested), so
 *   expect a ~4ms floor.
 * - **MessageChannel** (`port.postMessage`): also a task, but without the
 *   timer clamp — the most direct view of task-queue delay.
 * - **Microtask** (`queueMicrotask`): runs as soon as the measuring task ends,
 *   so it only captures the remainder of that task and stays near 0. It is a
 *   zero baseline, not a signal of its own — microtasks cannot be starved by
 *   other tasks.
 *
 * Both task-based latencies rise when the task queue backs up.
 */
export class SchedulingFairnessMonitor {
    private handle : number | undefined;
    private started = false;
    /** Bumped on start(): a cycle still in flight from before a stop/start must not report. */
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
        this.started = true;
        this.generation++;
        this.handle = this.setIntervalFn(() => this.measureCycle(), this.intervalMs);
    }

    stop() : void {
        this.started = false;
        if (this.handle !== undefined) {
            this.clearIntervalFn(this.handle);
            this.handle = undefined;
        }
    }

    private measureCycle() : void {
        try {
            // Three independent measurements per cycle, fired simultaneously.
            // We capture the start time once and let each scheduling primitive
            // report when it eventually fires.
            const start = this.clock.now();
            const generation = this.generation;
            const result : Partial<SchedulingMeasurement> = {};

            const checkComplete = () : void => {
                if (
                    this.started &&
                    generation === this.generation &&
                    result.macrotaskMs !== undefined &&
                    result.microtaskMs !== undefined &&
                    result.messageChannelMs !== undefined
                ) {
                    this.report(result as SchedulingMeasurement);
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

            // MessageChannel — port2.postMessage triggers port1.onmessage
            const channel = new this.MessageChannelCtor();
            channel.port1.onmessage = () => {
                result.messageChannelMs = this.clock.now() - start;
                channel.port1.onmessage = null;
                channel.port1.close?.();
                channel.port2.close?.();
                checkComplete();
            };
            channel.port1.start?.();
            channel.port2.postMessage(null);
        } catch (error) {
            this.logger.log("error", "Error in scheduling fairness measurement.", {
                error,
                type : "SchedulingFairnessMonitor",
            });
        }
    }
}
