import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createInstrumentedWorkerLag } from "./worker-lag.js";
import { createRecordingMeter } from "../test-utils.js";
import { createMemoryHangJournal, HANG_JOURNAL_STALE_MS, type HangJournal, type HangRecord } from "../hang-journal.js";
import { createIndexedDbHangJournal } from "../browser/indexeddb-journal.js";
import { createMeasurementConditions } from "../measurement-conditions.js";
import { createWorkerHandler } from "../lag-worker.js";
import { createFakeLifecycle } from "../vitals/test-fakes.js";
import type { WorkerLike } from "../WorkerLagMonitor.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "../worker-protocol.js";

const NOW = 1_700_000_000_000;

function setup(records : HangRecord[]) {
    const journal = createMemoryHangJournal();
    for (const record of records) void journal.put(record);
    const sent : MainToWorkerMessage[] = [];
    const worker : WorkerLike = {
        postMessage : (message) => { sent.push(message); },
        addEventListener : () => {},
        removeEventListener : () => {},
    };
    const meter = createRecordingMeter();
    const events = { emit : vi.fn() };
    const handle = createInstrumentedWorkerLag({
        logger : { log : vi.fn() },
        clock : { now : () => 0 },
        meter : meter.meter,
        worker,
        performance : { timeOrigin : NOW - 7_200_000, now : () => 0 },
        setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
        clearTimeoutFn : (id) => clearTimeout(id),
        events,
        hangJournal : journal,
        pageId : "this-page",
        // The monotonic clock of this page is far behind the wall clock, as after a sleep on macOS
        wallClock : { now : () => NOW },
    });
    return { handle, journal, meter, events, sent };
}

const record = (pageId : string, lastSeenAt : number, durationMs = 12_000) : HangRecord => ({
    pageId,
    startedAt : lastSeenAt - durationMs,
    lastSeenAt,
    attributes : { "lag.page_view.id" : `view-of-${pageId}` },
});

describe("createInstrumentedWorkerLag with a hang journal", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("reports the hangs that earlier pages did not survive, and removes their records", async () => {
        const t = setup([
            record("closed-page", NOW - HANG_JOURNAL_STALE_MS - 1),
            record("live-page", NOW - 500),
            record("this-page", NOW - 60_000),
        ]);
        await vi.advanceTimersByTimeAsync(0);

        expect(t.meter.records().get("lag_main_thread_hangs")).toEqual([{ value : 1, attributes : { outcome : "abandoned" } }]);
        expect(t.meter.records().get("lag_main_thread_hang_duration_histogram")).toEqual([{ value : 12_000, attributes : { outcome : "abandoned" } }]);
        expect(t.events.emit).toHaveBeenCalledWith("lag.main_thread.hang", {
            phase : "abandoned",
            duration_ms : 12_000,
            "lag.hang.page_id" : "closed-page",
            "lag.page_view.id" : "view-of-closed-page",
        });
        expect((await t.journal.list()).map(r => r.pageId).sort()).toEqual(["live-page", "this-page"]);
        t.handle.stop();
    });

    it("sends its page ID to the worker", () => {
        const t = setup([]);
        expect(t.sent.find(m => m.type === "start")).toMatchObject({ pageId : "this-page" });
        t.handle.stop();
    });

    it("sends no page ID without a journal, so that the worker writes no journal either", () => {
        const sent : MainToWorkerMessage[] = [];
        const handle = createInstrumentedWorkerLag({
            logger : { log : vi.fn() },
            clock : { now : () => 0 },
            meter : createRecordingMeter().meter,
            worker : { postMessage : (m) => { sent.push(m); }, addEventListener : () => {}, removeEventListener : () => {} },
            performance : { timeOrigin : NOW, now : () => 0 },
            setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
            clearTimeoutFn : (id) => clearTimeout(id),
            pageId : "this-page",
        });
        expect(sent.find(m => m.type === "start")).not.toHaveProperty("pageId");
        handle.stop();
    });

    it("reports nothing after stop()", async () => {
        const t = setup([record("closed-page", NOW - HANG_JOURNAL_STALE_MS - 1)]);
        t.handle.stop();
        await vi.advanceTimersByTimeAsync(0);
        expect(t.events.emit).not.toHaveBeenCalled();
    });
});

describe("createInstrumentedWorkerLag: two pages of the origin start at the same time (a session restore)", () => {
    /** One page that reads the journal. Each page has its own counter, and the backend adds them. */
    function page(pageId : string, journal : HangJournal) {
        const meter = createRecordingMeter();
        createInstrumentedWorkerLag({
            logger : { log : vi.fn() },
            clock : { now : () => 0 },
            meter : meter.meter,
            worker : { postMessage : () => {}, addEventListener : () => {}, removeEventListener : () => {} },
            performance : { timeOrigin : NOW, now : () => 0 },
            setTimeoutFn : () => 1,
            clearTimeoutFn : () => {},
            hangJournal : journal,
            pageId,
            wallClock : { now : () => NOW },
        });
        return meter;
    }

    it("reports an abandoned hang one time with a journal in memory", async () => {
        const journal = createMemoryHangJournal();
        await journal.put(record("closed-page", NOW - 60_000));
        const a = page("tab-a", journal);
        const b = page("tab-b", journal);
        await new Promise(resolve => setTimeout(resolve, 10));

        expect(a.sum("lag_main_thread_hangs") + b.sum("lag_main_thread_hangs")).toBe(1);
    });

    it("reports an abandoned hang one time with IndexedDB", async () => {
        const factory = new IDBFactory();
        await createIndexedDbHangJournal(factory).put(record("closed-page", NOW - 60_000));
        const a = page("tab-a", createIndexedDbHangJournal(factory));
        const b = page("tab-b", createIndexedDbHangJournal(factory));
        await new Promise(resolve => setTimeout(resolve, 200));

        expect(a.sum("lag_main_thread_hangs") + b.sum("lag_main_thread_hangs")).toBe(1);
    });
});

describe("createInstrumentedWorkerLag with a real worker handler", () => {
    it("counts a hang that ends while the page is hidden (the user changed the tab during the hang)", () => {
        let now = 0;
        const toWorker : MainToWorkerMessage[] = [];
        const toMain : WorkerToMainMessage[] = [];
        const workerTimers : Array<{ at : number; fn : () => void }> = [];
        const listeners = new Set<(event : { data : WorkerToMainMessage }) => void>();
        const worker : WorkerLike = {
            postMessage : (message) => { toWorker.push(message); },
            addEventListener : (_type, listener) => { listeners.add(listener); },
            removeEventListener : (_type, listener) => { listeners.delete(listener); },
        };
        const handler = createWorkerHandler({
            postMessage : (message) => toMain.push(message),
            setTimeoutFn : (fn, ms) => { workerTimers.push({ at : now + ms, fn }); return workerTimers.length; },
            clearTimeoutFn : () => { workerTimers.length = 0; },
            clock : { now : () => now },
        });
        const runWorker = () => { while (toWorker.length > 0) handler.handleMessage(toWorker.shift()!); };
        const runMain = () => {
            while (toMain.length > 0) {
                const message = toMain.shift()!;
                for (const listener of [...listeners]) listener({ data : message });
            }
        };
        const advanceWorker = (ms : number) => {
            const end = now + ms;
            for (;;) {
                workerTimers.sort((a, b) => a.at - b.at);
                const next = workerTimers[0];
                if (!next || next.at > end) break;
                workerTimers.shift();
                now = next.at;
                next.fn();
            }
            now = end;
        };

        const fake = createFakeLifecycle();
        const conditions = createMeasurementConditions({
            clock : { now : () => now },
            setTimeoutFn : () => 1,
            clearTimeoutFn : () => {},
            lifecycle : fake.lifecycle,
        });
        const meter = createRecordingMeter();
        createInstrumentedWorkerLag({
            logger : { log : vi.fn() },
            clock : { now : () => now },
            meter : meter.meter,
            worker,
            performance : { timeOrigin : 0, now : () => now },
            setTimeoutFn : () => 1,
            clearTimeoutFn : () => {},
        }, conditions);
        runWorker();
        toMain.length = 0;

        // The main thread is blocked for 8 s. The visibility change waits behind the heartbeats.
        advanceWorker(8_000);
        // The block ends: the main thread acknowledges the heartbeats, then the page becomes hidden
        runMain();
        fake.setVisibility("hidden");
        // The worker gets the first acknowledgement: the hang ends
        runWorker();
        runMain();

        expect(meter.sum("lag_main_thread_hangs")).toBe(1);
    });
});
