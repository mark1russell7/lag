import type { Clock, ClearIntervalFn, ClearTimeoutFn, SetIntervalFn, SetTimeoutFn, WallClock } from "./types.js";
import type { HangOptions, MainToWorkerMessage, WorkerToMainMessage } from "./worker-protocol.js";
import { LivenessWatcher } from "./shared-liveness.js";
import { HANG_JOURNAL_WRITE_INTERVAL_MS, type HangJournal } from "./hang-journal.js";

/** A hang as the worker sees it. Times are the worker's absolute time. */
export type HangEvent = {
    phase : "started" | "ended";
    /**
     * The time of the last acknowledgement before the hang. When the worker
     * itself did not operate during the hang (for example, the system
     * slept), this time moves forward by that period: the hang does not
     * include it.
     */
    startedAt : number;
    durationMs : number;
    /** The context of the page (the last `context` message), for example `lag.page_view.id`. */
    attributes : Readonly<Record<string, string>>;
};

export type WorkerDeps = {
    postMessage : (message : WorkerToMainMessage) => void;
    setTimeoutFn : SetTimeoutFn;
    clearTimeoutFn : ClearTimeoutFn;
    /** The clock must give absolute time: `performance.timeOrigin + performance.now()`. */
    clock : Clock;
    /**
     * The worker uses this function when a hang starts and when it ends. It
     * does so while the main thread is blocked. Thus, the function must not
     * depend on the main thread.
     */
    reportHang? : (event : HangEvent, options : HangOptions) => void;
    /** This function and `clearIntervalFn` are necessary for the shared-memory liveness watcher. */
    setIntervalFn? : SetIntervalFn;
    clearIntervalFn? : ClearIntervalFn;
    /**
     * Persistent storage for hangs in progress. When the main thread sends a
     * `pageId`, the worker keeps a record of each hang until the hang ends.
     * Thus, the next page can report a hang that the page did not survive.
     */
    journal? : HangJournal;
    /** The wall clock for the times of the journal. The default is `Date.now()`. */
    wallClock? : WallClock;
};

export type WorkerHandler = {
    handleMessage : (message : MainToWorkerMessage) => void;
    readonly running : boolean;
};

/**
 * The worker side of `WorkerLagMonitor`. It has these functions:
 * - a heartbeat loop on the timer of the worker, with a timestamp in each
 *   heartbeat
 * - answers to clock synchronization requests
 * - hang detection: when the main thread does not acknowledge heartbeats for
 *   `hang.thresholdMs`, the worker reports a hang itself
 * - with a journal, a persistent record of each hang in progress.
 *
 * The handler is idle until the main thread sends `start`.
 */
export function createWorkerHandler(deps : WorkerDeps) : WorkerHandler {
    const { postMessage, setTimeoutFn, clearTimeoutFn, clock, reportHang, setIntervalFn, clearIntervalFn, journal } = deps;
    const wallClock = deps.wallClock ?? { now : () => Date.now() };

    let intervalMs = 0;
    let handle : number | undefined;
    let expectedAt = 0;
    let seq = 0;
    let hang : HangOptions | undefined;
    let lastAckAt = 0;
    let hangStartedAt : number | undefined;
    let liveness : LivenessWatcher | undefined;
    let pageId : string | undefined;
    let context : Readonly<Record<string, string>> = {};
    let lastJournalWrite = 0;

    /** Journal operations are best effort: a failure must not stop the heartbeats. */
    function writeJournal(startedAt : number, now : number) : void {
        if (!journal || pageId === undefined) return;
        lastJournalWrite = now;
        // The journal uses the wall clock: the start is the same time before the wall-clock time now
        const wallNow = wallClock.now();
        journal.put({ pageId, startedAt : wallNow - (now - startedAt), lastSeenAt : wallNow, attributes : context }).catch(() => {});
    }

    function clearJournal() : void {
        if (!journal || pageId === undefined) return;
        journal.remove(pageId).catch(() => {});
    }

    function schedule() : void {
        expectedAt = clock.now() + intervalMs;
        handle = setTimeoutFn(tick, intervalMs);
    }

    function tick() : void {
        const now = clock.now();
        const workerSelfLagMs = Math.max(0, now - expectedAt);
        postMessage({ type : "heartbeat", seq : ++seq, sentAt : now, workerSelfLagMs });

        if (hang) {
            // The worker itself did not run (for example, the system slept): do not blame the main thread
            if (workerSelfLagMs >= hang.thresholdMs) {
                lastAckAt = now;
                if (hangStartedAt !== undefined) hangStartedAt += workerSelfLagMs;
            }
            if (hangStartedAt === undefined && now - lastAckAt >= hang.thresholdMs) {
                hangStartedAt = lastAckAt;
                reportHang?.({ phase : "started", startedAt : lastAckAt, durationMs : now - lastAckAt, attributes : context }, hang);
                writeJournal(hangStartedAt, now);
            } else if (hangStartedAt !== undefined && now - lastJournalWrite >= HANG_JOURNAL_WRITE_INTERVAL_MS) {
                writeJournal(hangStartedAt, now);
            }
        }
        schedule();
    }

    /** A message from the main thread is evidence that the main thread runs: the hang ended. */
    function endHang(now : number) : void {
        if (hangStartedAt === undefined) return;
        const startedAt = hangStartedAt;
        hangStartedAt = undefined;
        const durationMs = now - startedAt;
        clearJournal();
        if (hang) reportHang?.({ phase : "ended", startedAt, durationMs, attributes : context }, hang);
        postMessage({ type : "hang-ended", startedAt, durationMs });
    }

    function onAck() : void {
        const now = clock.now();
        lastAckAt = now;
        endHang(now);
    }

    function stop() : void {
        if (handle === undefined) return;
        clearTimeoutFn(handle);
        handle = undefined;
        // The main thread sent the stop, thus it runs. The main thread can stop the monitor
        // before it handles the heartbeats that waited, for example when the page became hidden.
        endHang(clock.now());
    }

    function handleMessage(message : MainToWorkerMessage) : void {
        switch (message.type) {
            case "start": {
                stop();
                intervalMs = message.intervalMs;
                hang = message.hang;
                pageId = message.pageId;
                lastAckAt = clock.now();
                schedule();
                break;
            }
            case "context": {
                context = { ...message.attributes };
                break;
            }
            case "stop": {
                stop();
                break;
            }
            case "ack": {
                onAck();
                break;
            }
            case "sync": {
                postMessage({ type : "sync-reply", id : message.id, workerTime : clock.now() });
                break;
            }
            case "liveness-start": {
                liveness?.stop();
                if (!setIntervalFn || !clearIntervalFn) break;
                liveness = new LivenessWatcher(
                    message.buffer,
                    (block) => postMessage({ type : "liveness-block", startedAt : block.startedAt, durationMs : block.durationMs }),
                    clock,
                    setIntervalFn,
                    clearIntervalFn,
                    { thresholdMs : message.thresholdMs, pollIntervalMs : message.pollIntervalMs },
                );
                liveness.start();
                break;
            }
            case "liveness-stop": {
                liveness?.stop();
                liveness = undefined;
                break;
            }
        }
    }

    return {
        handleMessage,
        get running() : boolean { return handle !== undefined; },
    };
}
