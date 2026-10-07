/** Main → worker: start the heartbeat loop, or restart it with a new interval. */
export type StartMessage = {
    type : "start";
    intervalMs : number;
};

/** Main → worker: stop the heartbeat loop. */
export type StopMessage = {
    type : "stop";
};

/**
 * Worker → main: one per interval, sent from the worker's own timer so it
 * keeps flowing while the main thread is blocked.
 *
 * `sentAt` is `performance.timeOrigin + performance.now()` in the worker: an
 * absolute timestamp directly comparable with the same expression evaluated
 * on the main thread.
 */
export type HeartbeatMessage = {
    type : "heartbeat";
    seq : number;
    sentAt : number;
    /** How late the worker's own timer fired for this heartbeat. */
    workerSelfLagMs : number;
};

export type MainToWorkerMessage = StartMessage | StopMessage;
export type WorkerToMainMessage = HeartbeatMessage;
