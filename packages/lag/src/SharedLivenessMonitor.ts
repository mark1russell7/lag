import type { Logger } from "./types.js";
import type { WorkerLike } from "./WorkerLagMonitor.js";
import type { WorkerToMainMessage } from "./worker-protocol.js";

export type SharedLivenessOptions = {
    /** A counter that does not change for this long is a block. Default: 50ms. */
    thresholdMs? : number;
    /** How often the worker reads the counter. Default: 5ms. */
    pollIntervalMs? : number;
};

const DEFAULT_THRESHOLD_MS = 50;
const DEFAULT_POLL_INTERVAL_MS = 5;

/**
 * The main-thread side of the shared-memory liveness watcher. It gives the
 * worker the shared buffer and receives the blocks that the worker saw.
 * The main thread must beat the counter often (see `beatingSetTimeout`).
 *
 * Unlike Long Animation Frames, this works in every engine that supports
 * `SharedArrayBuffer`, including Firefox and Safari. It needs cross-origin
 * isolation.
 */
export class SharedLivenessMonitor {
    private running = false;
    private readonly onMessage = (event : { data : WorkerToMainMessage }) : void => {
        const message = event.data;
        if (message?.type !== "liveness-block") return;
        try {
            this.report(message.durationMs);
        } catch (error) {
            this.logger.log("error", "Error processing a liveness block.", { error, type : "SharedLivenessMonitor" });
        }
    };

    constructor(
        private readonly worker : WorkerLike,
        private readonly buffer : SharedArrayBuffer,
        private readonly report : (blockDurationMs : number) => void,
        private readonly logger : Logger,
        private readonly options : SharedLivenessOptions = {},
    ) {
        this.start();
    }

    start() : void {
        if (this.running) return;
        this.running = true;
        this.worker.addEventListener("message", this.onMessage);
        this.worker.postMessage({
            type : "liveness-start",
            buffer : this.buffer,
            thresholdMs : this.options.thresholdMs ?? DEFAULT_THRESHOLD_MS,
            pollIntervalMs : this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
        });
    }

    stop() : void {
        if (!this.running) return;
        this.running = false;
        this.worker.removeEventListener("message", this.onMessage);
        this.worker.postMessage({ type : "liveness-stop" });
    }
}
