import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerLagMonitor, type WorkerLike, type WorkerLagMeasurement, type WorkerLagEvents } from "./WorkerLagMonitor.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./worker-protocol.js";
import { createAbsoluteClock } from "./absolute-clock.js";

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
        sent : (type : MainToWorkerMessage["type"]) => postMessage.mock.calls.map(c => c[0]).filter(m => m.type === type),
    };
}

function createMonitor(intervalMs = 1000, events : WorkerLagEvents = {}) {
    const mock = createMockWorker();
    const report = vi.fn<(m : WorkerLagMeasurement) => void>();
    const logger = { log : vi.fn() };
    // Main thread: timeOrigin 10_000, so absolute time = 10_000 + now
    const performance = { timeOrigin : 10_000, now : vi.fn(() => 0) };
    const monitor = new WorkerLagMonitor(mock.worker, report, logger, createAbsoluteClock(performance), {
        heartbeatIntervalMs : intervalMs,
        setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
        clearTimeoutFn : (id) => clearTimeout(id),
        hang : { thresholdMs : 5_000 },
        events,
    });
    // Not spread: that would freeze the `listenerCount` getter's value
    return Object.assign(mock, { report, logger, performance, monitor });
}

describe("WorkerLagMonitor", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("starts the worker's heartbeat loop with hang options and listens on construction", () => {
        const m = createMonitor(500);

        expect(m.sent("start")).toEqual([{ type : "start", intervalMs : 500, hang : { thresholdMs : 5_000 } }]);
        expect(m.listenerCount).toBe(1);
    });

    it("reports how long each heartbeat waited for the main thread, and acknowledges it", () => {
        const m = createMonitor();

        // Sent at absolute 10_100; main thread got to it at 10_000 + 350
        m.performance.now.mockReturnValue(350);
        m.deliver({ type : "heartbeat", seq : 7, sentAt : 10_100, workerSelfLagMs : 2 });

        expect(m.report).toHaveBeenCalledWith({ deliveryDelayMs : 250, workerSelfLagMs : 2, seq : 7 });
        expect(m.sent("ack")).toEqual([{ type : "ack", seq : 7 }]);
    });

    it("reports each queued heartbeat's wait after a block", () => {
        const m = createMonitor(100);

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

    it("synchronizes the clocks and corrects the delay by the measured offset", () => {
        const onClockSync = vi.fn();
        const m = createMonitor(1000, { onClockSync });

        // Answer each of the 8 sync requests at once; the worker clock is 40 ms ahead
        for (let i = 0; i < 8; i++) {
            const request = m.sent("sync").at(-1)!;
            m.deliver({ type : "sync-reply", id : (request as { id : number }).id, workerTime : 10_000 + 40 });
        }
        expect(onClockSync).toHaveBeenCalledWith({ offsetMs : 40, roundTripMs : 0 });

        // A heartbeat stamped by the fast worker clock
        m.performance.now.mockReturnValue(100);
        m.deliver({ type : "heartbeat", seq : 1, sentAt : 10_000 + 60 + 40, workerSelfLagMs : 0 });
        expect(m.report.mock.calls[0]![0].deliveryDelayMs).toBeCloseTo(40);
    });

    it("synchronizes the clocks again after the interval", () => {
        const m = createMonitor();
        const before = m.sent("sync").length;
        vi.advanceTimersByTime(60_000);
        expect(m.sent("sync").length).toBe(before + 1);
    });

    it("reports a system stall when the worker itself was late by 5 s or more", () => {
        const onSystemStall = vi.fn();
        const m = createMonitor(1000, { onSystemStall });

        m.performance.now.mockReturnValue(70_000);
        m.deliver({ type : "heartbeat", seq : 1, sentAt : 10_000 + 70_000, workerSelfLagMs : 60_000 });
        m.deliver({ type : "heartbeat", seq : 2, sentAt : 10_000 + 70_000, workerSelfLagMs : 20 });

        expect(onSystemStall).toHaveBeenCalledTimes(1);
        expect(onSystemStall).toHaveBeenCalledWith({ start : 10_000, end : 70_000, durationMs : 60_000 });
    });

    it("passes hang-ended messages on", () => {
        const onHangEnded = vi.fn();
        const m = createMonitor(1000, { onHangEnded });
        m.deliver({ type : "hang-ended", startedAt : 1, durationMs : 7_500 });
        expect(onHangEnded).toHaveBeenCalledWith(7_500);
    });

    it("stops the worker loop, the sync timer and the listener on stop, and can restart", () => {
        const m = createMonitor(250);

        m.monitor.stop();
        expect(m.listenerCount).toBe(0);
        expect(m.postMessage).toHaveBeenLastCalledWith({ type : "stop" });
        expect(vi.getTimerCount()).toBe(0);

        const stops = m.sent("stop").length;
        m.monitor.stop(); // idempotent
        expect(m.sent("stop").length).toBe(stops);

        m.monitor.start();
        expect(m.listenerCount).toBe(1);
        expect(m.sent("start").at(-1)).toEqual({ type : "start", intervalMs : 250, hang : { thresholdMs : 5_000 } });
    });

    it("ignores unknown messages", () => {
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
            "Error processing worker message.",
            expect.objectContaining({ type : "WorkerLagMonitor" }),
        );
    });
});
