import { vi, expect } from "vitest";
import { createWorkerHandler } from "./lag-worker.js";
import type { WorkerToMainMessage } from "./worker-protocol.js";

describe("lag-worker handler", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("responds to ping with pong", () => {
        const postMessage = vi.fn();
        let currentTime = 1000;
        const clock = { now : () => currentTime };

        const handler = createWorkerHandler({
            postMessage,
            setTimeoutFn : setTimeout,
            clock,
        });

        handler.handleMessage({
            type : "ping",
            mainSendTime : 500,
            seq : 1,
        });

        expect(postMessage).toHaveBeenCalledWith(
            expect.objectContaining({
                type : "pong",
                mainSendTime : 500,
                workerReceiveTime : 1000,
                seq : 1,
            }),
        );
    });

    it("measures self-lag in timing loop", () => {
        const postMessage = vi.fn();
        let currentTime = 0;
        const clock = { now : () => currentTime };

        const handler = createWorkerHandler({
            postMessage,
            setTimeoutFn : setTimeout,
            clock,
        });

        handler.startTimingLoop();

        // Advance time by more than intervalMs (100ms default)
        currentTime = 150; // 50ms lag
        vi.advanceTimersByTime(100);

        expect(handler.selfLag).toBe(50);
    });

    it("updates intervalMs on config message", () => {
        const postMessage = vi.fn();
        let currentTime = 0;
        const clock = { now : () => currentTime };

        const handler = createWorkerHandler({
            postMessage,
            setTimeoutFn : setTimeout,
            clock,
        });

        handler.handleMessage({ type : "config", intervalMs : 200 });
        handler.startTimingLoop();

        // Advance 200ms of real time, but clock advances 250ms (50ms lag)
        currentTime = 250;
        vi.advanceTimersByTime(200);

        expect(handler.selfLag).toBe(50);
    });

    it("stops timing loop on stop message", () => {
        const postMessage = vi.fn();
        let currentTime = 0;
        const clock = { now : () => currentTime };

        const handler = createWorkerHandler({
            postMessage,
            setTimeoutFn : setTimeout,
            clock,
        });

        handler.startTimingLoop();
        expect(handler.running).toBe(true);

        handler.handleMessage({ type : "stop" });
        expect(handler.running).toBe(false);
    });

    it("reports workerSelfLag from timing loop in pong", () => {
        const postMessage = vi.fn();
        let currentTime = 0;
        const clock = { now : () => currentTime };

        const handler = createWorkerHandler({
            postMessage,
            setTimeoutFn : setTimeout,
            clock,
        });

        handler.startTimingLoop();

        // Create some lag
        currentTime = 200; // 100ms lag on first tick
        vi.advanceTimersByTime(100);

        // Now ping
        currentTime = 250;
        handler.handleMessage({ type : "ping", mainSendTime : 200, seq : 1 });

        const pong = postMessage.mock.calls[0]![0] as WorkerToMainMessage;
        expect(pong.type).toBe("pong");
        if (pong.type === "pong") {
            expect(pong.workerSelfLag).toBe(100);
        }
    });

    it("prevents double-start of timing loop", () => {
        const mockSetTimeout = vi.fn(setTimeout);
        const clock = { now : () => 0 };

        const handler = createWorkerHandler({
            postMessage : vi.fn(),
            setTimeoutFn : mockSetTimeout,
            clock,
        });

        handler.startTimingLoop();
        const callCount = mockSetTimeout.mock.calls.length;

        handler.startTimingLoop();
        expect(mockSetTimeout.mock.calls.length).toBe(callCount);
    });
});
