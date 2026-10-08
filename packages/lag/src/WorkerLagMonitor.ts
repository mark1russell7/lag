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
     * How long the heartbeat waited before the main thread processed it. The
     * value is near zero when the main thread is responsive. While the main
     * thread is blocked, heartbeats queue up, and each one reports how long
     * it waited.
     */
    deliveryDelayMs : number;
    /**
     * How late the timer of the worker fired. A high value means that the
     * worker itself was starved or stopped. Thus, the worker also sent the
     * heartbeats late.
     */
    workerSelfLagMs : number;
    seq : number;
};

/** A period in which the worker itself did not operate, in the monotonic time of the main thread. */
export type SystemStall = {
    start : number;
    end : number;
    durationMs : number;
};

export type WorkerLagEvents = {
    /** The worker did not operate for `systemStallThresholdMs` or more. This is evidence of a system suspend. */
    onSystemStall? : (stall : SystemStall) => void;
    /** A hang that the worker detected ended. */
    onHangEnded? : (durationMs : number) => void;
    onClockSync? : (result : ClockSyncResult) => void;
};

export type WorkerLagMonitorOptions = {
    heartbeatIntervalMs : number;
    setTimeoutFn : SetTimeoutFn;
    clearTimeoutFn : ClearTimeoutFn;
    /** Without hang options, the worker does not detect hangs. */
    hang? : HangOptions;
    /** The smallest self lag of the worker that is a system stall. The default is 5000 ms. */
    systemStallThresholdMs? : number;
    /** The time between two clock synchronizations. The default is 60,000 ms. */
    clockSyncIntervalMs? : number;
    events? : WorkerLagEvents;
    /** The ID of this page instance, for the hang journal of the worker. */
    pageId? : string;
};

const DEFAULT_SYSTEM_STALL_THRESHOLD_MS = 5_000;
const DEFAULT_CLOCK_SYNC_INTERVAL_MS = 60_000;
/**
 * For the first heartbeat, the watchdog waits this number of heartbeat
 * intervals, and not less than `MIN_WATCHDOG_MS`.
 */
const WATCHDOG_INTERVALS = 5;
const MIN_WATCHDOG_MS = 5_000;

/**
 * This monitor measures the "ground truth" of main-thread blocking, from
 * outside the main thread.
 *
 * The timer-based monitors (`DriftLag` and `MacrotaskLag`) operate on the
 * main thread. Thus, they can see a block only after it ends. In this
 * monitor, a Web Worker sends heartbeats from its own timer (refer to
 * `createWorkerHandler`). Each heartbeat has an absolute send time. The
 * delay until the main thread handles the heartbeat is the time in which the
 * main thread could not process messages.
 *
 * The monitor also does these tasks:
 * - It acknowledges each heartbeat, so that the worker can detect and report
 *   hangs.
 * - It synchronizes the two clocks, and it corrects the delay by the offset.
 * - It reports system stalls, in which the worker itself did not operate.
 */
export class WorkerLagMonitor {
    private running = false;
    private listening = false;
    private syncHandle : number | undefined;
    private watchdogHandle : number | undefined;
    private heartbeatSeen = false;
    private context : Record<string, string> | undefined;
    private readonly clockSync : WorkerClockSync;
    private readonly onMessage = (event : { data : WorkerToMainMessage }) : void => {
        this.handleMessage(event.data);
    };

    constructor(
        private readonly worker : WorkerLike,
        private readonly report : (measurement : WorkerLagMeasurement) => void,
        private readonly logger : Logger,
        /** The absolute clock of the main thread. The worker must use the same type of clock. */
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
        this.heartbeatSeen = false;
        if (!this.listening) {
            this.worker.addEventListener("message", this.onMessage);
            this.listening = true;
        }
        this.worker.postMessage({
            type : "start",
            intervalMs : this.options.heartbeatIntervalMs,
            ...(this.options.hang ? { hang : this.options.hang } : {}),
            ...(this.options.pageId !== undefined ? { pageId : this.options.pageId } : {}),
        });
        if (this.context) this.worker.postMessage({ type : "context", attributes : this.context });
        this.syncClocks();
        this.startWatchdog(2);
    }

    /**
     * This method gives the worker the context of the page, for example the
     * ID of the current page view. The worker adds it to its hang reports.
     */
    setContext(attributes : Record<string, string>) : void {
        this.context = { ...attributes };
        if (this.running) this.worker.postMessage({ type : "context", attributes : this.context });
    }

    /**
     * This method stops the heartbeats, for example while the page is
     * hidden. The listener stays: a hang that was in progress ends at the
     * stop, and the worker then sends `hang-ended`. Use `dispose()` to remove
     * the listener.
     */
    stop() : void {
        if (!this.running) return;
        this.running = false;
        if (this.syncHandle !== undefined) {
            this.options.clearTimeoutFn(this.syncHandle);
            this.syncHandle = undefined;
        }
        if (this.watchdogHandle !== undefined) {
            this.options.clearTimeoutFn(this.watchdogHandle);
            this.watchdogHandle = undefined;
        }
        this.worker.postMessage({ type : "stop" });
    }

    /** This method stops the monitor and removes its listener from the worker. */
    dispose() : void {
        this.stop();
        if (!this.listening) return;
        this.worker.removeEventListener("message", this.onMessage);
        this.listening = false;
    }

    /** The last clock synchronization result, if one finished. */
    getClockSync() : ClockSyncResult | undefined {
        return this.clockSync.getResult();
    }

    /**
     * A worker that cannot load sends nothing, and nothing else reports the
     * problem. Examples are an import error, a Content-Security-Policy
     * without `worker-src`, or a crash. The watchdog warns when no heartbeat
     * came in two checks. The first check can occur before the queued
     * heartbeats, after a long task at the start of the page.
     */
    private startWatchdog(checks : number) : void {
        const delay = Math.max(MIN_WATCHDOG_MS, WATCHDOG_INTERVALS * this.options.heartbeatIntervalMs);
        this.watchdogHandle = this.options.setTimeoutFn(() => {
            this.watchdogHandle = undefined;
            if (this.heartbeatSeen || !this.running) return;
            if (checks > 1) {
                this.startWatchdog(checks - 1);
                return;
            }
            this.logger.log("warn", "The worker sent no heartbeat. Make sure that the worker loads and runs the @lag/worker handler.", {
                type : "WorkerLagMonitor",
                waitedMs : 2 * delay,
            });
        }, delay);
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
            // While stopped, only the end of a hang is applicable
            if (!this.running && message?.type !== "hang-ended") return;
            switch (message?.type) {
                case "heartbeat": {
                    this.heartbeatSeen = true;
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
            // The worker did not run before it sent the heartbeat. After the send, the heartbeat
            // waited `deliveryDelayMs` for the main thread: that time is not part of the stall.
            const end = this.clock.monotonic() - deliveryDelayMs;
            this.options.events?.onSystemStall?.({ start : end - workerSelfLagMs, end, durationMs : workerSelfLagMs });
        }
    }
}
