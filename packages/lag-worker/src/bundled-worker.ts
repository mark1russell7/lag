import { createWorkerHandler } from "@render/lag/lag-worker.js";

const handler = createWorkerHandler({
    postMessage : (message) => self.postMessage(message),
    setTimeoutFn : (fn, ms) => self.setTimeout(fn, ms),
    clock : { now : () => performance.now() },
});

self.addEventListener("message", (event : MessageEvent) => {
    handler.handleMessage(event.data);
});

handler.startTimingLoop();
