import { createWorkerHandler } from "@lag/core/lag-worker.js";

const handler = createWorkerHandler({
    postMessage : (message) => self.postMessage(message),
    setTimeoutFn : (fn, ms) => self.setTimeout(fn, ms),
    clearTimeoutFn : (id) => self.clearTimeout(id),
    clock : { now : () => performance.timeOrigin + performance.now() },
});

self.addEventListener("message", (event : MessageEvent) => {
    handler.handleMessage(event.data);
});
