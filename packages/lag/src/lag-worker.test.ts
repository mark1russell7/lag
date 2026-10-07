import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkerHandler, type HangEvent } from "./lag-worker.js";
import type { WorkerToMainMessage } from "./worker-protocol.js";
import { createMemoryHangJournal, type HangJournal } from "./hang-journal.js";

/** The wall clock of the tests is 1 000 000 ms ahead of the monotonic clock. */
const WALL_OFFSET = 1_000_000;

function createHandler(startTime = 0, journal? : HangJournal) {
    let currentTime = startTime;
    const postMessage = vi.fn<(message : WorkerToMainMessage) => void>();
    const reportHang = vi.fn<(event : HangEvent) => void>();
    const handler = createWorkerHandler({
        postMessage,
        setTimeoutFn : setTimeout,
        clearTimeoutFn : clearTimeout,
        clock : { now : () => currentTime },
        wallClock : { now : () => WALL_OFFSET + currentTime },
        reportHang,
        ...(journal ? { journal } : {}),
    });
    return {
        handler,
        postMessage,
        reportHang,
        /** Advance both the mocked clock and the fake timers. */
        advance(timerMs : number, clockMs = timerMs) {
            currentTime += clockMs;
            vi.advanceTimersByTime(timerMs);
        },
        messages : (type : WorkerToMainMessage["type"]) => postMessage.mock.calls.map(c => c[0]).filter(m => m.type === type),
        ackAll(this : void) {
            for (const m of postMessage.mock.calls.map(c => c[0])) {
                if (m.type === "heartbeat") handler.handleMessage({ type : "ack", seq : m.seq });
            }
        },
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

        expect(w.messages("heartbeat")).toEqual([
            { type : "heartbeat", seq : 1, sentAt : 1100, workerSelfLagMs : 0 },
            { type : "heartbeat", seq : 2, sentAt : 1200, workerSelfLagMs : 0 },
        ]);
    });

    it("reports how late its own timer fired as workerSelfLagMs", () => {
        const w = createHandler();
        w.handler.handleMessage({ type : "start", intervalMs : 100 });

        w.advance(100, 150); // timer fired 50ms late

        expect(w.messages("heartbeat")[0]).toEqual(expect.objectContaining({ sentAt : 150, workerSelfLagMs : 50 }));
    });

    it("answers a sync request with its absolute time", () => {
        const w = createHandler(5_000);
        w.handler.handleMessage({ type : "sync", id : 3 });
        expect(w.messages("sync-reply")).toEqual([{ type : "sync-reply", id : 3, workerTime : 5_000 }]);
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

    describe("hang detection", () => {
        it("reports a hang when acks stop, and the end when they resume", () => {
            const w = createHandler();
            w.handler.handleMessage({ type : "start", intervalMs : 100, hang : { thresholdMs : 1_000 } });

            w.advance(100);
            w.ackAll(); // the main thread answered at t=100
            for (let i = 0; i < 10; i++) w.advance(100);

            expect(w.reportHang).toHaveBeenCalledWith({ phase : "started", startedAt : 100, durationMs : 1_000, attributes : {} }, expect.anything());

            w.handler.handleMessage({ type : "ack", seq : 11 });
            expect(w.reportHang).toHaveBeenLastCalledWith({ phase : "ended", startedAt : 100, durationMs : 1_000, attributes : {} }, expect.anything());
            expect(w.messages("hang-ended")).toEqual([{ type : "hang-ended", startedAt : 100, durationMs : 1_000 }]);
        });

        it("reports each hang once", () => {
            const w = createHandler();
            w.handler.handleMessage({ type : "start", intervalMs : 100, hang : { thresholdMs : 300 } });
            for (let i = 0; i < 20; i++) w.advance(100);
            expect(w.reportHang).toHaveBeenCalledTimes(1);
        });

        it("does not report a hang while the main thread acknowledges heartbeats", () => {
            const w = createHandler();
            w.handler.handleMessage({ type : "start", intervalMs : 100, hang : { thresholdMs : 300 } });
            for (let i = 0; i < 20; i++) {
                w.advance(100);
                w.ackAll();
            }
            expect(w.reportHang).not.toHaveBeenCalled();
        });

        it("does not blame the main thread for time in which the worker itself did not run", () => {
            const w = createHandler();
            w.handler.handleMessage({ type : "start", intervalMs : 100, hang : { thresholdMs : 1_000 } });

            // The system sleeps for an hour: the worker's timer fires an hour late
            w.advance(100, 3_600_000);

            expect(w.reportHang).not.toHaveBeenCalled();
        });

        it("does not add the time in which the worker itself did not run to a hang in progress", () => {
            const w = createHandler();
            w.handler.handleMessage({ type : "start", intervalMs : 1_000, hang : { thresholdMs : 5_000 } });
            for (let i = 0; i < 6; i++) w.advance(1_000);
            expect(w.reportHang).toHaveBeenCalledWith(expect.objectContaining({ phase : "started", startedAt : 0 }), expect.anything());

            // A sleep of 1 h on Windows (performance.now() continues): the next timer is 1 h late
            w.advance(1_000, 3_601_000);
            w.advance(0, 500);
            w.handler.handleMessage({ type : "ack", seq : 7 });

            expect(w.reportHang).toHaveBeenLastCalledWith(expect.objectContaining({ phase : "ended", durationMs : 7_500 }), expect.anything());
            expect(w.messages("hang-ended")).toEqual([expect.objectContaining({ durationMs : 7_500 })]);
        });

        it("ends a hang in progress at a stop, because the main thread sent the stop", () => {
            const w = createHandler();
            w.handler.handleMessage({ type : "start", intervalMs : 1_000, hang : { thresholdMs : 5_000 } });
            for (let i = 0; i < 7; i++) w.advance(1_000);
            // The main thread stops the monitor (the page became hidden) before it handles the heartbeats that waited
            w.advance(0, 200);
            w.handler.handleMessage({ type : "stop" });

            expect(w.reportHang.mock.calls.map(([event]) => event.phase)).toEqual(["started", "ended"]);
            expect(w.messages("hang-ended")).toEqual([{ type : "hang-ended", startedAt : 0, durationMs : 7_200 }]);
        });

        it("does not detect hangs without hang options", () => {
            const w = createHandler();
            w.handler.handleMessage({ type : "start", intervalMs : 100 });
            for (let i = 0; i < 100; i++) w.advance(100);
            expect(w.reportHang).not.toHaveBeenCalled();
        });
    });

    describe("page context and hang journal", () => {
        /** Lets the promise jobs of the journal finish. */
        const settle = () => vi.advanceTimersByTimeAsync(0);

        it("adds the last context to its hang reports", () => {
            const w = createHandler();
            w.handler.handleMessage({ type : "start", intervalMs : 100, hang : { thresholdMs : 300 } });
            w.handler.handleMessage({ type : "context", attributes : { "lag.page_view.id" : "view-1" } });
            w.handler.handleMessage({ type : "context", attributes : { "lag.page_view.id" : "view-2" } });
            for (let i = 0; i < 4; i++) w.advance(100);

            expect(w.reportHang).toHaveBeenCalledWith(expect.objectContaining({ phase : "started", attributes : { "lag.page_view.id" : "view-2" } }), expect.anything());
        });

        it("writes a record when a hang starts, writes it again each second, and removes it when the hang ends", async () => {
            const journal = createMemoryHangJournal();
            const put = vi.spyOn(journal, "put");
            const remove = vi.spyOn(journal, "remove");
            const w = createHandler(0, journal);
            w.handler.handleMessage({ type : "start", intervalMs : 100, hang : { thresholdMs : 1_000 }, pageId : "page-a" });
            w.handler.handleMessage({ type : "context", attributes : { "lag.page_view.id" : "view-1" } });

            for (let i = 0; i < 10; i++) w.advance(100);
            await settle();
            expect(await journal.list()).toEqual([{
                pageId : "page-a",
                startedAt : WALL_OFFSET,
                lastSeenAt : WALL_OFFSET + 1_000,
                attributes : { "lag.page_view.id" : "view-1" },
            }]);

            for (let i = 0; i < 10; i++) w.advance(100);
            await settle();
            expect(put).toHaveBeenCalledTimes(2);
            expect((await journal.list())[0]!.lastSeenAt).toBe(WALL_OFFSET + 2_000);

            w.handler.handleMessage({ type : "ack", seq : 20 });
            await settle();
            expect(remove).toHaveBeenCalledWith("page-a");
            expect(await journal.list()).toEqual([]);
        });

        it("removes the record when it stops during a hang", async () => {
            const journal = createMemoryHangJournal();
            const w = createHandler(0, journal);
            w.handler.handleMessage({ type : "start", intervalMs : 100, hang : { thresholdMs : 300 }, pageId : "page-a" });
            for (let i = 0; i < 5; i++) w.advance(100);
            await settle();
            expect(await journal.list()).toHaveLength(1);

            w.handler.handleMessage({ type : "stop" });
            await settle();
            expect(await journal.list()).toEqual([]);
        });

        it("keeps no record without a page ID", async () => {
            const journal = createMemoryHangJournal();
            const w = createHandler(0, journal);
            w.handler.handleMessage({ type : "start", intervalMs : 100, hang : { thresholdMs : 300 } });
            for (let i = 0; i < 5; i++) w.advance(100);
            await settle();
            expect(await journal.list()).toEqual([]);
        });

        it("continues the heartbeats when the journal fails", async () => {
            const journal : HangJournal = {
                put : () => Promise.reject(new Error("quota")),
                remove : () => Promise.reject(new Error("quota")),
                list : () => Promise.resolve([]),
                take : () => Promise.reject(new Error("quota")),
            };
            const w = createHandler(0, journal);
            w.handler.handleMessage({ type : "start", intervalMs : 100, hang : { thresholdMs : 300 }, pageId : "page-a" });
            for (let i = 0; i < 10; i++) w.advance(100);
            await settle();

            expect(w.messages("heartbeat")).toHaveLength(10);
        });
    });
});
