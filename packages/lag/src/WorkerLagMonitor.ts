import type { ClearTimeoutFn, Logger, SetTimeoutFn } from "./types.js";
import type { AbsoluteClock } from "./absolute-clock.js";
import type { HangOptions, MainToWorkerMessage, WorkerToMainMessage } from "./worker-protocol.js";
import { WorkerClockSync, type ClockSyncResult } from "./WorkerClockSync.js";

export type WorkerLike = {
    postMessage(message : MainToWorkerMessage) : void;
    addEventListener(type : "message", handler : (event : { data : WorkerToMainMessage }) => void) : void;
    removeEventListener(type : "message", handler : (event : { data : WorkerToMainMessage }) => void) : void;
};

export type WorkerLagMeasurement = {
    /**
     * How long the heartbeat waited before the main thread processed it.
     * Near zero when the main thread is responsive; while it is blocked,
     * heartbeats queue up and each reports how long it waited.
     */
    deliveryDelayMs : number;
    /**
     * How late the worker's own timer fired. High values mean the worker was
     * itself starved or stopped, so heartbeats were sent late too.
     */
    workerSelfLagMs : number;
    seq : number;
};

/** A period in which the worker itself did not run, in main-thread monotonic time. */
export type SystemStall = {
    start : number;
    end : number;
    durationMs : number;
};

export type WorkerLagEvents = {
    /** The worker did not run for at least `systemStallThresholdMs`: evidence of a system suspend. */
    onSystemStall? : (stall : SystemStall) => void;
    /** A hang that the worker detected has ended. */
    onHangEnded? : (durationMs : number) => void;
    onClockSync? : (result : ClockSyncResult) => void;
};

export type WorkerLagMonitorOptions = {
    heartbeatIntervalMs : number;
    setTimeoutFn : SetTimeoutFn;
    clearTimeoutFn : ClearTimeoutFn;
    /** Without hang options, the worker does not detect hangs. */
    hang? : HangOptions;
    /** Default: 5000ms. */
    systemStallThresholdMs? : number;
    /** How often to synchronize the clocks again. Default: 60 000ms. */
    clockSyncIntervalMs? : number;
    events? : WorkerLagEvents;
};

const DEFAULT_SYSTEM_STALL_THRESHOLD_MS = 5_000;
const DEFAULT_CLOCK_SYNC_INTERVAL_MS = 60_000;

/**
 * Ground-truth main-thread blocking, measured from outside the main thread.
 *
 * Timer-based monitors (DriftLag, MacrotaskLag) run on the main thread, so
 * they can only see a block after it ends. Here a Web Worker sends
 * heartbeats from its own timer (see `createWorkerHandler`). Each heartbeat
 * has an absolute send time, and the delay until the main thread handles it
 * is the time the main thread could not process messages.
 *
 * The monitor also:
 * - acknowledges each heartbeat, so the worker can detect and report hangs;
 * - synchronizes the two clocks and corrects the delay by the offset;
 * - reports system stalls, in which the worker itself did not run.
 */
export class WorkerLagMonitor {
    private running = false;
    private syncHandle : number | undefined;
    private readonly clockSync : WorkerClockSync;
    private readonly onMessage = (event : { data : WorkerToMainMessage }) : void => {
        this.handleMessage(event.data);
    };

    constructor(
        private readonly worker : WorkerLike,
        private readonly report : (measurement : WorkerLagMeasurement) => void,
        private readonly logger : Logger,
        /** The absolute clock of the main thread. The worker must use the same kind of clock. */
        private readonly clock : AbsoluteClock,
        private readonly options : WorkerLagMonitorOptions,
    ) {
        this.clockSync = new WorkerClockSync(
            (id) => this.worker.postMessage({ type : "sync", id }),
            () => this.clock.now(),
            (result) => this.options.events?.onClockSync?.(result),
        );
        this.start();
    }

    start() : void {
        if (this.running) return;
        this.running = true;
        this.worker.addEventListener("message", this.onMessage);
        this.worker.postMessage({
            type : "start",
            intervalMs : this.options.heartbeatIntervalMs,
            ...(this.options.hang ? { hang : this.options.hang } : {}),
        });
        this.syncClocks();
    }

    stop() : void {
        if (!this.running) return;
        this.running = false;
        if (this.syncHandle !== undefined) {
            this.options.clearTimeoutFn(this.syncHandle);
            this.syncHandle = undefined;
        }
        this.worker.removeEventListener("message", this.onMessage);
        this.worker.postMessage({ type : "stop" });
    }

    /** The last clock synchronization result, if one finished. */
    getClockSync() : ClockSyncResult | undefined {
        return this.clockSync.getResult();
    }

    private syncClocks() : void {
        this.clockSync.begin();
        this.syncHandle = this.options.setTimeoutFn(
            () => this.syncClocks(),
            this.options.clockSyncIntervalMs ?? DEFAULT_CLOCK_SYNC_INTERVAL_MS,
        );
    }

    private handleMessage(message : WorkerToMainMessage) : void {
        try {
            switch (message?.type) {
                case "heartbeat": {
                    this.worker.postMessage({ type : "ack", seq : message.seq });
                    this.handleHeartbeat(message.sentAt, message.workerSelfLagMs, message.seq);
                    break;
                }
                case "sync-reply": {
                    this.clockSync.onReply(message.id, message.workerTime);
                    break;
                }
                case "hang-ended": {
                    this.options.events?.onHangEnded?.(message.durationMs);
                    break;
                }
            }
        } catch (error) {
            this.logger.log("error", "Error processing worker message.", {
                error,
                type : "WorkerLagMonitor",
            });
        }
    }

    private handleHeartbeat(sentAt : number, workerSelfLagMs : number, seq : number) : void {
        const receivedAt = this.clock.now();
        // The worker clock runs `correction` ms ahead of the main-thread clock
        const deliveryDelayMs = Math.max(0, receivedAt - sentAt + this.clockSync.getCorrectionMs());
        this.report({ deliveryDelayMs, workerSelfLagMs, seq });

        const stallThreshold = this.options.systemStallThresholdMs ?? DEFAULT_SYSTEM_STALL_THRESHOLD_MS;
        if (workerSelfLagMs >= stallThreshold) {
            const end = this.clock.monotonic();
            this.options.events?.onSystemStall?.({ start : end - workerSelfLagMs, end, durationMs : workerSelfLagMs });
        }
    }
}
