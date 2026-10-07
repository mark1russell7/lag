/**
 * Where the worker sends a hang report while the main thread is blocked. The
 * main thread cannot send anything then, so the worker sends the report
 * itself, as an OTLP/HTTP JSON log record.
 */
export type HangReportTarget = {
    /** The OTLP logs URL, for example `http://localhost:4318/v1/logs`. */
    url : string;
    /** Resource attributes for the report, for example `{ "service.name": "shop" }`. */
    resource? : Record<string, string>;
};

export type HangOptions = {
    /** A main thread that does not acknowledge heartbeats for this long is hung. */
    thresholdMs : number;
    report? : HangReportTarget;
};

/** Main → worker: start the heartbeat loop, or restart it with new options. */
export type StartMessage = {
    type : "start";
    intervalMs : number;
    hang? : HangOptions;
    /** The ID of the page instance. The worker uses it for the hang journal. */
    pageId? : string;
};

/**
 * Main → worker: the context of the page, for example the ID of the current
 * page view. The worker adds it to hang reports and to the hang journal. A
 * new context message replaces the earlier context.
 */
export type ContextMessage = {
    type : "context";
    attributes : Record<string, string>;
};

/** Main → worker: stop the heartbeat loop. */
export type StopMessage = {
    type : "stop";
};

/** Main → worker: the main thread handled heartbeat `seq`. The worker uses acks to detect hangs. */
export type AckMessage = {
    type : "ack";
    seq : number;
};

/** Main → worker: a clock synchronization request. */
export type SyncRequestMessage = {
    type : "sync";
    id : number;
};

/**
 * Main → worker: watch the liveness counter in `buffer` (a
 * `SharedArrayBuffer`, so the page must be cross-origin isolated).
 */
export type LivenessStartMessage = {
    type : "liveness-start";
    buffer : SharedArrayBuffer;
    thresholdMs : number;
    pollIntervalMs : number;
};

/** Main → worker: stop watching the liveness counter. */
export type LivenessStopMessage = {
    type : "liveness-stop";
};

/**
 * Worker → main: one per interval, sent from the worker's own timer so it
 * keeps flowing while the main thread is blocked.
 *
 * `sentAt` is `performance.timeOrigin + performance.now()` in the worker: an
 * absolute timestamp, comparable with the same expression on the main thread
 * after the clock synchronization correction.
 */
export type HeartbeatMessage = {
    type : "heartbeat";
    seq : number;
    sentAt : number;
    /** How late the worker's own timer fired for this heartbeat. */
    workerSelfLagMs : number;
};

/** Worker → main: the answer to a `sync` request, with the worker's absolute time. */
export type SyncReplyMessage = {
    type : "sync-reply";
    id : number;
    workerTime : number;
};

/** Worker → main: a hang ended. The main thread reads this when it can run again. */
export type HangEndedMessage = {
    type : "hang-ended";
    /** The worker's absolute time of the last acknowledgement before the hang. */
    startedAt : number;
    durationMs : number;
};

/** Worker → main: a main-thread block that the liveness watcher saw. Times are the worker's absolute time. */
export type LivenessBlockMessage = {
    type : "liveness-block";
    startedAt : number;
    durationMs : number;
};

export type MainToWorkerMessage =
    | StartMessage | StopMessage | AckMessage | SyncRequestMessage | ContextMessage | LivenessStartMessage | LivenessStopMessage;
export type WorkerToMainMessage = HeartbeatMessage | SyncReplyMessage | HangEndedMessage | LivenessBlockMessage;
