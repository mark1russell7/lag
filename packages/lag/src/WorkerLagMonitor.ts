import type { Logger, PerformanceLike } from "./types.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./worker-protocol.js";

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
     * itself starved (e.g. CPU contention), so heartbeats were sent late too.
     */
    workerSelfLagMs : number;
    seq : number;
};

/**
 * Ground-truth main-thread blocking, measured from outside the main thread.
 *
 * Timer-based monitors (DriftLag, MacrotaskLag) run *on* the main thread, so
 * they can only notice a block after it ends. Here a Web Worker sends
 * heartbeats from its own timer (see `createWorkerHandler`); each carries an
 * absolute send time, and the delay until the main thread handles it is the
 * time the main thread was unable to process messages.
 */
export class WorkerLagMonitor {
    private running = false;
    private readonly onMessage = (event : { data : WorkerToMainMessage }) : void => {
        this.handleHeartbeat(event.data);
    };

    constructor(
        private readonly worker : WorkerLike,
        private readonly report : (measurement : WorkerLagMeasurement) => void,
        private readonly logger : Logger,
        private readonly performance : PerformanceLike,
        private readonly heartbeatIntervalMs : number,
    ) {
        this.start();
    }

    start() : void {
        if (this.running) return;
        this.running = true;
        this.worker.addEventListener("message", this.onMessage);
        this.worker.postMessage({ type : "start", intervalMs : this.heartbeatIntervalMs });
    }

    stop() : void {
        if (!this.running) return;
        this.running = false;
        this.worker.removeEventListener("message", this.onMessage);
        this.worker.postMessage({ type : "stop" });
    }

    private handleHeartbeat(message : WorkerToMainMessage) : void {
        if (message?.type !== "heartbeat") return;

        try {
            const receivedAt = this.performance.timeOrigin + this.performance.now();
            this.report({
                // Clamp sub-millisecond negatives from clock rounding
                deliveryDelayMs : Math.max(0, receivedAt - message.sentAt),
                workerSelfLagMs : message.workerSelfLagMs,
                seq : message.seq,
            });
        } catch (error) {
            this.logger.log("error", "Error processing worker heartbeat.", {
                error,
                type : "WorkerLagMonitor",
            });
        }
    }
}
