import type { WorkerLike } from "@lag/core/WorkerLagMonitor.js";

export type LagWorker = WorkerLike & {
    /** Kill the worker thread. The caller owns the worker: stopping a monitor doesn't do this. */
    terminate() : void;
};

export function createLagWorker() : LagWorker {
    const worker = new Worker(
        new URL("./bundled-worker.js", import.meta.url),
        { type : "module" },
    );

    return {
        postMessage : (message) => worker.postMessage(message),
        addEventListener : (type, handler) => worker.addEventListener(type, handler),
        removeEventListener : (type, handler) => worker.removeEventListener(type, handler),
        terminate : () => worker.terminate(),
    };
}
