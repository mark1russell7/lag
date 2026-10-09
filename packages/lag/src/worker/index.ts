import type { WorkerLike } from "../WorkerLagMonitor.js";

export type LagWorker = WorkerLike & {
    /**
     * This method stops the worker thread (`worker.terminate()`). The caller
     * owns the worker. The stop of a monitor does not stop the worker.
     */
    terminate() : void;
};

/**
 * This function starts the Web Worker of the worker-lag monitor. Give the
 * result to `createBrowserDeps()` as `worker`. The bundler of the app must
 * support module workers with `new Worker(new URL(...), { type: "module" })`,
 * for example Vite or webpack 5.
 */
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
