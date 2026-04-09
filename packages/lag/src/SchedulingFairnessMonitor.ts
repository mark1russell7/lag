import type { Clock, Logger, SetIntervalFn, ClearIntervalFn, SetTimeoutFn } from "./types.js";

// Duck-typed MessageChannel — no DOM lib dependency
export type MessageChannelLike = {
    port1 : MessagePortLike;
    port2 : MessagePortLike;
};

export type MessagePortLike = {
    postMessage(data : unknown) : void;
    onmessage : ((event : { data : unknown }) => void) | null;
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
 * Measures relative scheduling latency of three browser scheduling primitives:
 *
 * - **Microtask** (`queueMicrotask`): Drained immediately after current task. Highest priority.
 * - **MessageChannel** (`port.postMessage`): Macrotask, but typically higher priority
 *   than setTimeout. Used by libraries like Vue/React for batching.
 * - **Macrotask** (`setTimeout(0)`): Lowest priority of the three. Subject to 4ms clamping.
 *
 * Comparing these reveals scheduling fairness: if microtask >> 0 while macrotask is normal,
 * something is starving microtasks. If macrotask >> messageChannel, the macrotask queue is
 * backed up. If all three are elevated, the main thread is genuinely overloaded.
 */
export class SchedulingFairnessMonitor {
    private handle : number | undefined;
    private started = false;

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
            const result : Partial<SchedulingMeasurement> = {};

            const checkComplete = () : void => {
                if (
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
                if (channel.port1.close) channel.port1.close();
                checkComplete();
            };
            if (channel.port1.start) channel.port1.start();
            channel.port2.postMessage(null);
        } catch (error) {
            this.logger.log("error", "Error in scheduling fairness measurement.", {
                error,
                type : "SchedulingFairnessMonitor",
            });
        }
    }
}
