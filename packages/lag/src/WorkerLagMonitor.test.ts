import { vi, expect } from "vitest";
import { WorkerLagMonitor, type WorkerLike, type WorkerLagMeasurement } from "./WorkerLagMonitor.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./worker-protocol.js";

function createMockWorker() {
    const listeners : Array<(event : { data : WorkerToMainMessage }) => void> = [];
    const postMessage = vi.fn<(message : MainToWorkerMessage) => void>();

    const worker : WorkerLike = {
        postMessage,
        addEventListener(_type, handler) {
            listeners.push(handler);
        },
        removeEventListener(_type, handler) {
            const idx = listeners.indexOf(handler);
            if (idx >= 0) listeners.splice(idx, 1);
        },
    };

    return {
        worker,
        postMessage,
        deliver(message : WorkerToMainMessage) {
            for (const listener of [...listeners]) listener({ data : message });
        },
        get listenerCount() {
            return listeners.length;
        },
    };
}

function createMonitor(intervalMs = 1000) {
    const mock = createMockWorker();
    const report = vi.fn<(m : WorkerLagMeasurement) => void>();
    const logger = { log : vi.fn() };
    // Main thread: timeOrigin 10_000, so absolute time = 10_000 + now
    const performance = { timeOrigin : 10_000, now : vi.fn(() => 0) };
    const monitor = new WorkerLagMonitor(mock.worker, report, logger, performance, intervalMs);
    // Not spread: that would freeze the `listenerCount` getter's value
    return Object.assign(mock, { report, logger, performance, monitor });
}

describe("WorkerLagMonitor", () => {
    it("starts the worker's heartbeat loop and listens on construction", () => {
        const m = createMonitor(500);

        expect(m.postMessage).toHaveBeenCalledWith({ type : "start", intervalMs : 500 });
        expect(m.listenerCount).toBe(1);
    });

    it("reports how long each heartbeat waited for the main thread", () => {
        const m = createMonitor();

        // Sent at absolute 10_100; main thread got to it at 10_000 + 350
        m.performance.now.mockReturnValue(350);
        m.deliver({ type : "heartbeat", seq : 7, sentAt : 10_100, workerSelfLagMs : 2 });

        expect(m.report).toHaveBeenCalledWith({ deliveryDelayMs : 250, workerSelfLagMs : 2, seq : 7 });
    });

    it("reports each queued heartbeat's wait after a block", () => {
        const m = createMonitor(100);

        // Main thread blocked until absolute 10_500; three heartbeats queued meanwhile
        m.performance.now.mockReturnValue(500);
        for (const [seq, sentAt] of [[1, 10_200], [2, 10_300], [3, 10_400]] as const) {
            m.deliver({ type : "heartbeat", seq, sentAt, workerSelfLagMs : 0 });
        }

        expect(m.report.mock.calls.map(c => c[0].deliveryDelayMs)).toEqual([300, 200, 100]);
    });

    it("clamps tiny negative delays from clock rounding to zero", () => {
        const m = createMonitor();

        m.performance.now.mockReturnValue(100);
        m.deliver({ type : "heartbeat", seq : 1, sentAt : 10_100.02, workerSelfLagMs : 0 });

        expect(m.report.mock.calls[0]![0].deliveryDelayMs).toBe(0);
    });

    it("stops the worker loop and detaches on stop, and can restart", () => {
        const m = createMonitor(250);

        m.monitor.stop();
        expect(m.listenerCount).toBe(0);
        expect(m.postMessage).toHaveBeenLastCalledWith({ type : "stop" });

        m.monitor.stop(); // idempotent
        expect(m.postMessage).toHaveBeenCalledTimes(2);

        m.monitor.start();
        expect(m.listenerCount).toBe(1);
        expect(m.postMessage).toHaveBeenLastCalledWith({ type : "start", intervalMs : 250 });
    });

    it("ignores messages that aren't heartbeats", () => {
        const m = createMonitor();

        m.deliver({ type : "something-else" } as unknown as WorkerToMainMessage);

        expect(m.report).not.toHaveBeenCalled();
    });

    it("logs instead of throwing when report throws", () => {
        const m = createMonitor();
        m.report.mockImplementation(() => { throw new Error("boom"); });

        m.deliver({ type : "heartbeat", seq : 1, sentAt : 10_000, workerSelfLagMs : 0 });

        expect(m.logger.log).toHaveBeenCalledWith(
            "error",
            "Error processing worker heartbeat.",
            expect.objectContaining({ type : "WorkerLagMonitor" }),
        );
    });
});
