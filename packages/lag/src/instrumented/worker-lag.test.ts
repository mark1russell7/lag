import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createInstrumentedWorkerLag } from "./worker-lag.js";
import { createRecordingMeter, expectCatalogEvents, expectCatalogInstruments } from "../test-utils.js";
import { createMemoryHangJournal, HANG_JOURNAL_STALE_MS, type HangJournal, type HangRecord } from "../hang-journal.js";
import { createIndexedDbHangJournal } from "../browser/indexeddb-journal.js";
import { createMeasurementConditions, type MeasurementConditions } from "../measurement-conditions.js";
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
        expectCatalogInstruments(t.meter);
        expectCatalogEvents(t.events.emit);
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

describe("createInstrumentedWorkerLag with the messages of a worker", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW);
    });

    afterEach(() => vi.useRealTimers());

    /** A monitor on a worker whose messages the test sends. The absolute time of the main thread is `NOW`. */
    function withWorker(options : {
        journal? : HangJournal;
        events? : boolean;
        wallClock? : boolean;
        conditions? : MeasurementConditions;
        workerHangReport? : { url : string };
    } = {}) {
        const listeners = new Set<(event : { data : WorkerToMainMessage }) => void>();
        const sent : MainToWorkerMessage[] = [];
        const meter = createRecordingMeter();
        const events = { emit : vi.fn() };
        const logger = { log : vi.fn() };
        const handle = createInstrumentedWorkerLag({
            logger,
            clock : { now : () => 0 },
            meter : meter.meter,
            worker : {
                postMessage : (message) => { sent.push(message); },
                addEventListener : (_type, listener) => { listeners.add(listener); },
                removeEventListener : (_type, listener) => { listeners.delete(listener); },
            },
            performance : { timeOrigin : NOW, now : () => Date.now() - NOW },
            setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
            clearTimeoutFn : (id) => clearTimeout(id),
            pageId : "this-page",
            ...(options.journal ? { hangJournal : options.journal } : {}),
            ...(options.events === false ? {} : { events }),
            ...(options.wallClock === false ? {} : { wallClock : { now : () => NOW } }),
            ...(options.workerHangReport ? { workerHangReport : options.workerHangReport } : {}),
        }, options.conditions);
        return {
            handle,
            sent,
            meter,
            events,
            logger,
            deliver(message : WorkerToMainMessage) {
                for (const listener of [...listeners]) listener({ data : message });
            },
        };
    }

    it("gives the hang report target to the worker", () => {
        const t = withWorker({ workerHangReport : { url : "https://otel.example/v1/logs" } });

        expect(t.sent.find(m => m.type === "start")).toMatchObject({ hang : { thresholdMs : 5_000, report : { url : "https://otel.example/v1/logs" } } });
        t.handle.stop();
    });

    it("counts a hang that the worker ended, with the outcome ended, and records its duration", () => {
        const t = withWorker();

        t.deliver({ type : "hang-ended", startedAt : NOW - 8_000, durationMs : 8_000 });
        t.handle.stop();

        expect(t.meter.records().get("lag_main_thread_hangs")).toEqual([{ value : 1, attributes : { outcome : "ended" } }]);
        expect(t.meter.records().get("lag_main_thread_hang_duration_histogram")).toEqual([{ value : 8_000, attributes : { outcome : "ended" } }]);
        expect(t.events.emit).toHaveBeenCalledWith("lag.main_thread.hang", { phase : "ended", duration_ms : 8_000 });
        expectCatalogInstruments(t.meter);
        expectCatalogEvents(t.events.emit);
    });

    it("handles a system stall and the end of a hang without measurement conditions and without an event sink", () => {
        const t = withWorker({ events : false });

        t.deliver({ type : "heartbeat", seq : 1, sentAt : NOW, workerSelfLagMs : 6_000 });
        t.deliver({ type : "hang-ended", startedAt : NOW - 8_000, durationMs : 8_000 });
        t.handle.stop();

        expect(t.meter.values("lag_worker_self_lag_histogram")).toEqual([6_000]);
        expect(t.meter.sum("lag_main_thread_hangs")).toBe(1);
        expect(t.logger.log).not.toHaveBeenCalled();
    });

    it("stop() cancels the heartbeat delays that wait for evidence", () => {
        const conditions = createMeasurementConditions({
            clock : { now : () => Date.now() },
            setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
            clearTimeoutFn : (id) => clearTimeout(id),
        });
        const t = withWorker({ conditions });

        // The heartbeat waited 6 s for the main thread
        t.deliver({ type : "heartbeat", seq : 1, sentAt : NOW - 6_000, workerSelfLagMs : 0 });
        t.handle.stop();
        vi.advanceTimersByTime(5_000);

        expect(t.meter.values("lag_worker_main_block_histogram")).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("uses Date.now() to find the abandoned hangs when the dependencies have no wall clock", async () => {
        const journal = createMemoryHangJournal();
        await journal.put(record("closed-page", NOW - HANG_JOURNAL_STALE_MS - 1));
        const t = withWorker({ journal, wallClock : false });
        await vi.advanceTimersByTimeAsync(0);
        t.handle.stop();

        expect(t.meter.records().get("lag_main_thread_hangs")).toEqual([{ value : 1, attributes : { outcome : "abandoned" } }]);
        expect(t.logger.log).not.toHaveBeenCalled();
    });

    it("reports an abandoned hang without an event sink", async () => {
        const journal = createMemoryHangJournal();
        await journal.put(record("closed-page", NOW - 60_000));
        const t = withWorker({ journal, events : false });
        await vi.advanceTimersByTimeAsync(0);
        t.handle.stop();

        expect(t.meter.sum("lag_main_thread_hangs")).toBe(1);
        expect(t.logger.log).not.toHaveBeenCalled();
    });

    it("does not report a hang whose record another page updated after the read, because the hang continues", async () => {
        const journal = createMemoryHangJournal();
        // The worker of the other page wrote the record again 1 s ago
        await journal.put(record("other-page", NOW - 1_000));
        const stale = record("other-page", NOW - 60_000);
        const t = withWorker({ journal : { ...journal, list : () => Promise.resolve([stale]) } });
        await vi.advanceTimersByTimeAsync(0);
        t.handle.stop();

        expect(t.meter.sum("lag_main_thread_hangs")).toBe(0);
        expect((await journal.list()).map(r => r.pageId)).toEqual(["other-page"]);
    });

    it("skips a record that another page took first", async () => {
        const journal = createMemoryHangJournal();
        const t = withWorker({ journal : { ...journal, list : () => Promise.resolve([record("closed-page", NOW - 60_000)]) } });
        await vi.advanceTimersByTimeAsync(0);
        t.handle.stop();

        expect(t.meter.sum("lag_main_thread_hangs")).toBe(0);
        expect(t.logger.log).not.toHaveBeenCalled();
    });

    it("puts a record back for the next page when the monitor stops while it takes the record", async () => {
        const journal = createMemoryHangJournal();
        await journal.put(record("closed-page", NOW - 60_000));
        let release : () => void = () => {};
        const slow : HangJournal = {
            ...journal,
            take : (pageId, latestSeenAt) => new Promise(resolve => { release = () => resolve(journal.take(pageId, latestSeenAt)); }),
        };
        const t = withWorker({ journal : slow });
        await vi.advanceTimersByTimeAsync(0);

        t.handle.stop();
        release();
        await vi.advanceTimersByTimeAsync(0);

        expect(t.events.emit).not.toHaveBeenCalled();
        expect((await journal.list()).map(r => r.pageId)).toEqual(["closed-page"]);
    });

    it("logs a warning when it cannot read the hang journal", async () => {
        const journal = createMemoryHangJournal();
        const t = withWorker({ journal : { ...journal, list : () => Promise.reject(new Error("blocked")) } });
        await vi.advanceTimersByTimeAsync(0);
        t.handle.stop();

        expect(t.logger.log).toHaveBeenCalledWith("warn", "Could not read the hang journal.", { error : expect.any(Error), type : "WorkerLagMonitor" });
    });
});
