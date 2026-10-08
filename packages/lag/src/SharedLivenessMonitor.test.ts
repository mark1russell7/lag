import { describe, expect, it, vi } from "vitest";
import { SharedLivenessMonitor, type SharedLivenessOptions } from "./SharedLivenessMonitor.js";
import { LIVENESS_BUFFER_BYTES } from "./shared-liveness.js";
import type { WorkerLike } from "./WorkerLagMonitor.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./worker-protocol.js";

/** A worker that records the messages from the main thread. `deliver` sends a message to the "message" listeners of the main thread. */
function createMockWorker() {
    const listeners = new Set<(event : { data : WorkerToMainMessage }) => void>();
    const sent : MainToWorkerMessage[] = [];
    const worker : WorkerLike = {
        postMessage : (message) => { sent.push(message); },
        addEventListener : (type, listener) => { if (type === "message") listeners.add(listener); },
        removeEventListener : (type, listener) => { if (type === "message") listeners.delete(listener); },
    };
    return {
        worker,
        sent,
        deliver(message : WorkerToMainMessage) {
            for (const listener of [...listeners]) listener({ data : message });
        },
        listenerCount : () => listeners.size,
    };
}

function createMonitor(options? : SharedLivenessOptions) {
    const mock = createMockWorker();
    const buffer = new SharedArrayBuffer(LIVENESS_BUFFER_BYTES);
    const report = vi.fn<(blockDurationMs : number) => void>();
    const logger = { log : vi.fn() };
    const monitor = new SharedLivenessMonitor(mock.worker, buffer, report, logger, options);
    return { ...mock, buffer, report, logger, monitor };
}

const block = (durationMs : number) : WorkerToMainMessage => ({ type : "liveness-block", startedAt : 1_000, durationMs });

describe("SharedLivenessMonitor", () => {
    it("gives the buffer to the worker at construction, with a threshold of 50 ms and a poll interval of 5 ms", () => {
        const m = createMonitor();

        expect(m.sent).toEqual([{ type : "liveness-start", buffer : m.buffer, thresholdMs : 50, pollIntervalMs : 5 }]);
        expect((m.sent[0] as { buffer : SharedArrayBuffer }).buffer).toBe(m.buffer);
        expect(m.listenerCount()).toBe(1);
    });

    it("gives the worker the threshold and the poll interval of the options", () => {
        const m = createMonitor({ thresholdMs : 120, pollIntervalMs : 10 });

        expect(m.sent).toEqual([expect.objectContaining({ type : "liveness-start", thresholdMs : 120, pollIntervalMs : 10 })]);
    });

    it("reports the duration of each block that the worker saw", () => {
        const m = createMonitor();

        m.deliver(block(230));
        m.deliver(block(75));

        expect(m.report.mock.calls).toEqual([[230], [75]]);
    });

    it("ignores the other messages of the worker", () => {
        const m = createMonitor();

        m.deliver({ type : "heartbeat", seq : 1, sentAt : 1_000, workerSelfLagMs : 0 });
        m.deliver({ type : "hang-ended", startedAt : 1_000, durationMs : 8_000 });
        m.deliver(undefined as unknown as WorkerToMainMessage);

        expect(m.report).not.toHaveBeenCalled();
        expect(m.logger.log).not.toHaveBeenCalled();
    });

    it("logs an error from the report function and continues with the next block", () => {
        const m = createMonitor();
        m.report.mockImplementationOnce(() => { throw new Error("export failed"); });

        m.deliver(block(230));
        m.deliver(block(75));

        expect(m.logger.log).toHaveBeenCalledWith("error", "Error processing a liveness block.", expect.objectContaining({ type : "SharedLivenessMonitor" }));
        expect(m.report).toHaveBeenLastCalledWith(75);
    });

    it("stop() removes the listener and stops the watcher of the worker, and a second stop() does nothing", () => {
        const m = createMonitor();

        m.monitor.stop();
        m.deliver(block(230));
        m.monitor.stop();

        expect(m.listenerCount()).toBe(0);
        expect(m.report).not.toHaveBeenCalled();
        expect(m.sent.map(message => message.type)).toEqual(["liveness-start", "liveness-stop"]);
    });

    it("start() after stop() starts the watcher again, and start() while the monitor operates does nothing", () => {
        const m = createMonitor();

        m.monitor.start();
        m.monitor.stop();
        m.monitor.start();
        m.deliver(block(230));

        expect(m.sent.map(message => message.type)).toEqual(["liveness-start", "liveness-stop", "liveness-start"]);
        expect(m.listenerCount()).toBe(1);
        expect(m.report.mock.calls).toEqual([[230]]);
    });
});
