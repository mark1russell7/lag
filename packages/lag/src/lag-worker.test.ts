import { vi, expect } from "vitest";
import { createWorkerHandler } from "./lag-worker.js";
import type { HeartbeatMessage } from "./worker-protocol.js";

function createHandler(startTime = 0) {
    let currentTime = startTime;
    const postMessage = vi.fn<(message : HeartbeatMessage) => void>();
    const handler = createWorkerHandler({
        postMessage,
        setTimeoutFn : setTimeout,
        clearTimeoutFn : clearTimeout,
        clock : { now : () => currentTime },
    });
    return {
        handler,
        postMessage,
        /** Advance both the mocked clock and the fake timers. */
        advance(timerMs : number, clockMs = timerMs) {
            currentTime += clockMs;
            vi.advanceTimersByTime(timerMs);
        },
        heartbeats : () => postMessage.mock.calls.map(c => c[0]),
    };
}

describe("lag-worker handler", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("stays idle until told to start", () => {
        const w = createHandler();
        w.advance(10_000);
        expect(w.handler.running).toBe(false);
        expect(w.postMessage).not.toHaveBeenCalled();
    });

    it("posts a timestamped heartbeat every interval once started", () => {
        const w = createHandler(1000);
        w.handler.handleMessage({ type : "start", intervalMs : 100 });

        w.advance(100);
        w.advance(100);

        expect(w.heartbeats()).toEqual([
            { type : "heartbeat", seq : 1, sentAt : 1100, workerSelfLagMs : 0 },
            { type : "heartbeat", seq : 2, sentAt : 1200, workerSelfLagMs : 0 },
        ]);
    });

    it("reports how late its own timer fired as workerSelfLagMs", () => {
        const w = createHandler();
        w.handler.handleMessage({ type : "start", intervalMs : 100 });

        w.advance(100, 150); // timer fired 50ms late

        expect(w.heartbeats()[0]).toEqual(expect.objectContaining({ sentAt : 150, workerSelfLagMs : 50 }));
    });

    it("stops the loop on stop and can be restarted", () => {
        const w = createHandler();
        w.handler.handleMessage({ type : "start", intervalMs : 100 });
        w.handler.handleMessage({ type : "stop" });
        expect(w.handler.running).toBe(false);

        w.advance(1000);
        expect(w.postMessage).not.toHaveBeenCalled();

        w.handler.handleMessage({ type : "start", intervalMs : 100 });
        expect(w.handler.running).toBe(true);
        w.advance(100);
        expect(w.postMessage).toHaveBeenCalledTimes(1);
    });

    it("restarting with a new interval replaces the old loop instead of adding one", () => {
        const w = createHandler();
        w.handler.handleMessage({ type : "start", intervalMs : 100 });
        w.handler.handleMessage({ type : "start", intervalMs : 300 });

        w.advance(300);

        expect(w.postMessage).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(1);
    });
});
