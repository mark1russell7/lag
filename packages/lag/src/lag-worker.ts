import type { Clock, SetTimeoutFn } from "./types.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./worker-protocol.js";

export type WorkerDeps = {
    postMessage : (message : WorkerToMainMessage) => void;
    setTimeoutFn : SetTimeoutFn;
    clock : Clock;
};

export function createWorkerHandler(deps : WorkerDeps) {
    const { postMessage, setTimeoutFn, clock } = deps;

    let intervalMs = 100;
    let running = false;
    let lastTickTime = 0;
    let selfLag = 0;

    function startTimingLoop() : void {
        if (running) return;
        running = true;
        lastTickTime = clock.now();
        tick();
    }

    function tick() : void {
        if (!running) return;

        const now = clock.now();
        const elapsed = now - lastTickTime;
        selfLag = Math.max(0, elapsed - intervalMs);
        lastTickTime = now;

        setTimeoutFn(() => tick(), intervalMs);
    }

    function handleMessage(message : MainToWorkerMessage) : void {
        switch (message.type) {
            case "ping": {
                const workerReceiveTime = clock.now();
                postMessage({
                    type : "pong",
                    mainSendTime : message.mainSendTime,
                    workerReceiveTime,
                    workerSendTime : clock.now(),
                    workerSelfLag : selfLag,
                    seq : message.seq,
                });
                break;
            }
            case "config": {
                intervalMs = message.intervalMs;
                break;
            }
            case "stop": {
                running = false;
                break;
            }
        }
    }

    return {
        handleMessage,
        startTimingLoop,
        get selfLag() { return selfLag; },
        get running() { return running; },
    };
}
