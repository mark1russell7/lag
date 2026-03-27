import { vi, expect } from "vitest";
import { WorkerLagMonitor, type WorkerLike } from "./WorkerLagMonitor.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./worker-protocol.js";

function createMockWorker() {
    const listeners = new Map<string, ((event : { data : WorkerToMainMessage }) => void)[]>();
    const postMessageSpy = vi.fn();

    const worker : WorkerLike = {
        postMessage : postMessageSpy,
        addEventListener(type : string, handler : (event : { data : WorkerToMainMessage }) => void) {
            if (!listeners.has(type)) listeners.set(type, []);
            listeners.get(type)!.push(handler);
        },
        removeEventListener(type : string, handler : (event : { data : WorkerToMainMessage }) => void) {
            const arr = listeners.get(type);
            if (arr) {
                const idx = arr.indexOf(handler);
                if (idx >= 0) arr.splice(idx, 1);
            }
        },
    };

    return {
        worker,
        postMessageSpy,
        simulatePong(pong : WorkerToMainMessage) {
            listeners.get("message")?.forEach(h => h({ data : pong }));
        },
        get listenerCount() {
            return listeners.get("message")?.length ?? 0;
        },
    };
}

describe("WorkerLagMonitor", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("sends config and registers message listener on start", () => {
        const mock = createMockWorker();
        const logger = { log : vi.fn() };
        let currentTime = 0;

        new WorkerLagMonitor(
            mock.worker, vi.fn(), logger,
            setInterval, clearInterval,
            { now : () => currentTime },
            1000,
        );

        // Should have sent a config message
        expect(mock.postMessageSpy).toHaveBeenCalledWith(
            expect.objectContaining({ type : "config", intervalMs : 1000 }),
        );
        expect(mock.listenerCount).toBe(1);
    });

    it("sends pings at the configured interval", () => {
        const { worker, postMessageSpy } = createMockWorker();
        const logger = { log : vi.fn() };
        let currentTime = 0;

        new WorkerLagMonitor(
            worker, vi.fn(), logger,
            setInterval, clearInterval,
            { now : () => currentTime },
            500,
        );

        // Initial config message
        expect(postMessageSpy).toHaveBeenCalledTimes(1);

        // Advance past first ping
        currentTime = 500;
        vi.advanceTimersByTime(500);

        // Should have sent config + ping
        expect(postMessageSpy).toHaveBeenCalledTimes(2);
        const pingMsg = postMessageSpy.mock.calls[1]![0] as MainToWorkerMessage;
        expect(pingMsg.type).toBe("ping");
    });

    it("reports measurements from pong responses", () => {
        const { worker, simulatePong } = createMockWorker();
        const report = vi.fn();
        const logger = { log : vi.fn() };
        let currentTime = 0;

        new WorkerLagMonitor(
            worker, report, logger,
            setInterval, clearInterval,
            { now : () => currentTime },
            1000,
        );

        // Simulate pong arriving 20ms after ping
        currentTime = 20;
        simulatePong({
            type : "pong",
            mainSendTime : 0,
            workerReceiveTime : 5,
            workerSendTime : 6,
            workerSelfLag : 2,
            seq : 1,
        });

        expect(report).toHaveBeenCalledWith({
            roundTripMs : 20,      // mainReceiveTime(20) - mainSendTime(0)
            workerSelfLagMs : 2,
            estimatedMainBlockMs : 18,  // max(0, 20 - 2)
            seq : 1,
        });
    });

    it("clamps estimated main block to zero", () => {
        const { worker, simulatePong } = createMockWorker();
        const report = vi.fn();
        const logger = { log : vi.fn() };
        let currentTime = 0;

        new WorkerLagMonitor(
            worker, report, logger,
            setInterval, clearInterval,
            { now : () => currentTime },
            1000,
        );

        // Pong with workerSelfLag > roundTrip (shouldn't happen, but handle it)
        currentTime = 5;
        simulatePong({
            type : "pong",
            mainSendTime : 0,
            workerReceiveTime : 1,
            workerSendTime : 2,
            workerSelfLag : 100,
            seq : 1,
        });

        expect(report.mock.calls[0]![0].estimatedMainBlockMs).toBe(0);
    });

    it("cleans up on stop", () => {
        const mock = createMockWorker();
        const logger = { log : vi.fn() };

        const monitor = new WorkerLagMonitor(
            mock.worker, vi.fn(), logger,
            setInterval, clearInterval,
            { now : () => 0 },
            1000,
        );

        expect(mock.listenerCount).toBe(1);
        monitor.stop();
        expect(mock.listenerCount).toBe(0);

        // Should have sent a stop message
        expect(mock.postMessageSpy).toHaveBeenCalledWith({ type : "stop" });
    });

    it("ignores non-pong messages", () => {
        const { worker, simulatePong } = createMockWorker();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new WorkerLagMonitor(
            worker, report, logger,
            setInterval, clearInterval,
            { now : () => 0 },
            1000,
        );

        // Send a message with wrong type (cast to bypass type check)
        simulatePong({ type : "config", intervalMs : 100 } as any);

        expect(report).not.toHaveBeenCalled();
    });
});
