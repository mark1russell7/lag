import type { WorkerLike } from "@render/lag/WorkerLagMonitor.js";

export function createLagWorker() : WorkerLike {
    const worker = new Worker(
        new URL("./bundled-worker.js", import.meta.url),
        { type : "module" },
    );

    return {
        postMessage : (message) => worker.postMessage(message),
        addEventListener : (type, handler) => worker.addEventListener(type, handler),
        removeEventListener : (type, handler) => worker.removeEventListener(type, handler),
    };
}
