import type { Clock, ClearIntervalFn, Logger, SetIntervalFn } from "./types.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./worker-protocol.js";

export type WorkerLike = {
    postMessage(message : MainToWorkerMessage) : void;
    addEventListener(type : "message", handler : (event : { data : WorkerToMainMessage }) => void) : void;
    removeEventListener(type : "message", handler : (event : { data : WorkerToMainMessage }) => void) : void;
};

export type WorkerLagMeasurement = {
    roundTripMs : number;
    workerSelfLagMs : number;
    estimatedMainBlockMs : number;
    seq : number;
};

export class WorkerLagMonitor {
    private handle : number | undefined;
    private seq = 0;
    private messageHandler : (event : { data : WorkerToMainMessage }) => void;

    constructor(
        private readonly worker : WorkerLike,
        private readonly report : (measurement : WorkerLagMeasurement) => void,
        private readonly logger : Logger,
        private readonly setIntervalFn : SetIntervalFn,
        private readonly clearIntervalFn : ClearIntervalFn,
        private readonly clock : Clock,
        private readonly pingIntervalMs : number,
    ) {
        this.messageHandler = (event) => this.handlePong(event.data);
        this.start();
    }

    start() : void {
        if (this.handle !== undefined) return;

        this.worker.addEventListener("message", this.messageHandler);

        // Configure worker timing loop
        this.worker.postMessage({
            type : "config",
            intervalMs : this.pingIntervalMs,
        });

        this.handle = this.setIntervalFn(() => this.sendPing(), this.pingIntervalMs);
    }

    stop() : void {
        if (this.handle !== undefined) {
            this.clearIntervalFn(this.handle);
            this.handle = undefined;
        }
        this.worker.removeEventListener("message", this.messageHandler);
        this.worker.postMessage({ type : "stop" });
    }

    private sendPing() : void {
        const seq = ++this.seq;
        this.worker.postMessage({
            type : "ping",
            mainSendTime : this.clock.now(),
            seq,
        });
    }

    private handlePong(message : WorkerToMainMessage) : void {
        if (message.type !== "pong") return;

        try {
            const mainReceiveTime = this.clock.now();
            const roundTripMs = mainReceiveTime - message.mainSendTime;
            const workerSelfLagMs = message.workerSelfLag;
            const estimatedMainBlockMs = Math.max(0, roundTripMs - workerSelfLagMs);

            this.report({
                roundTripMs,
                workerSelfLagMs,
                estimatedMainBlockMs,
                seq : message.seq,
            });
        } catch (error) {
            this.logger.log("error", "Error processing worker pong.", {
                error,
                type : "WorkerLagMonitor",
            });
        }
    }
}
