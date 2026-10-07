import type { Clock, ClearTimeoutFn, SetTimeoutFn } from "./types.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./worker-protocol.js";

export type WorkerDeps = {
    postMessage : (message : WorkerToMainMessage) => void;
    setTimeoutFn : SetTimeoutFn;
    clearTimeoutFn : ClearTimeoutFn;
    /** Must return absolute time: `performance.timeOrigin + performance.now()`. */
    clock : Clock;
};

export type WorkerHandler = {
    handleMessage : (message : MainToWorkerMessage) => void;
    readonly running : boolean;
};

/**
 * Worker-side half of WorkerLagMonitor: runs a heartbeat loop on the worker's
 * own timer and posts a timestamped heartbeat to the main thread each tick.
 * Idle until the main thread sends `start`.
 */
export function createWorkerHandler(deps : WorkerDeps) : WorkerHandler {
    const { postMessage, setTimeoutFn, clearTimeoutFn, clock } = deps;

    let intervalMs = 0;
    let handle : number | undefined;
    let expectedAt = 0;
    let seq = 0;

    function schedule() : void {
        expectedAt = clock.now() + intervalMs;
        handle = setTimeoutFn(tick, intervalMs);
    }

    function tick() : void {
        const now = clock.now();
        postMessage({
            type : "heartbeat",
            seq : ++seq,
            sentAt : now,
            workerSelfLagMs : Math.max(0, now - expectedAt),
        });
        schedule();
    }

    function stop() : void {
        if (handle === undefined) return;
        clearTimeoutFn(handle);
        handle = undefined;
    }

    function handleMessage(message : MainToWorkerMessage) : void {
        switch (message.type) {
            case "start": {
                stop();
                intervalMs = message.intervalMs;
                schedule();
                break;
            }
            case "stop": {
                stop();
                break;
            }
        }
    }

    return {
        handleMessage,
        get running() : boolean { return handle !== undefined; },
    };
}
