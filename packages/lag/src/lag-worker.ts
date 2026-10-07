import type { Clock, ClearIntervalFn, ClearTimeoutFn, SetIntervalFn, SetTimeoutFn } from "./types.js";
import type { HangOptions, MainToWorkerMessage, WorkerToMainMessage } from "./worker-protocol.js";
import { LivenessWatcher } from "./shared-liveness.js";

/** A hang as the worker sees it. Times are the worker's absolute time. */
export type HangEvent = {
    phase : "started" | "ended";
    /** The time of the last acknowledgement before the hang. */
    startedAt : number;
    durationMs : number;
};

export type WorkerDeps = {
    postMessage : (message : WorkerToMainMessage) => void;
    setTimeoutFn : SetTimeoutFn;
    clearTimeoutFn : ClearTimeoutFn;
    /** Must return absolute time: `performance.timeOrigin + performance.now()`. */
    clock : Clock;
    /**
     * Called when a hang starts and when it ends. The worker calls it while
     * the main thread is blocked, so it must not depend on the main thread.
     */
    reportHang? : (event : HangEvent, options : HangOptions) => void;
    /** Required for the shared-memory liveness watcher. */
    setIntervalFn? : SetIntervalFn;
    clearIntervalFn? : ClearIntervalFn;
};

export type WorkerHandler = {
    handleMessage : (message : MainToWorkerMessage) => void;
    readonly running : boolean;
};

/**
 * Worker-side half of WorkerLagMonitor:
 * - a heartbeat loop on the worker's own timer, with a timestamp in each
 *   heartbeat;
 * - answers to clock synchronization requests;
 * - hang detection: when the main thread does not acknowledge heartbeats for
 *   `hang.thresholdMs`, the worker reports a hang itself.
 *
 * Idle until the main thread sends `start`.
 */
export function createWorkerHandler(deps : WorkerDeps) : WorkerHandler {
    const { postMessage, setTimeoutFn, clearTimeoutFn, clock, reportHang, setIntervalFn, clearIntervalFn } = deps;

    let intervalMs = 0;
    let handle : number | undefined;
    let expectedAt = 0;
    let seq = 0;
    let hang : HangOptions | undefined;
    let lastAckAt = 0;
    let hangStartedAt : number | undefined;
    let liveness : LivenessWatcher | undefined;

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
            if (workerSelfLagMs >= hang.thresholdMs) lastAckAt = now;
            if (hangStartedAt === undefined && now - lastAckAt >= hang.thresholdMs) {
                hangStartedAt = lastAckAt;
                reportHang?.({ phase : "started", startedAt : lastAckAt, durationMs : now - lastAckAt }, hang);
            }
        }
        schedule();
    }

    function onAck() : void {
        const now = clock.now();
        lastAckAt = now;
        if (hangStartedAt === undefined) return;
        const startedAt = hangStartedAt;
        hangStartedAt = undefined;
        const durationMs = now - startedAt;
        if (hang) reportHang?.({ phase : "ended", startedAt, durationMs }, hang);
        postMessage({ type : "hang-ended", startedAt, durationMs });
    }

    function stop() : void {
        if (handle === undefined) return;
        clearTimeoutFn(handle);
        handle = undefined;
        hangStartedAt = undefined;
    }

    function handleMessage(message : MainToWorkerMessage) : void {
        switch (message.type) {
            case "start": {
                stop();
                intervalMs = message.intervalMs;
                hang = message.hang;
                lastAckAt = clock.now();
                schedule();
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
