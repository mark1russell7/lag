import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstrumentedWorkerLag } from "./worker-lag.js";
import { createRecordingMeter } from "../test-utils.js";
import { createMemoryHangJournal, HANG_JOURNAL_STALE_MS, type HangRecord } from "../hang-journal.js";
import type { WorkerLike } from "../WorkerLagMonitor.js";
import type { MainToWorkerMessage } from "../worker-protocol.js";

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
        performance : { timeOrigin : NOW, now : () => 0 },
        setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
        clearTimeoutFn : (id) => clearTimeout(id),
        events,
        hangJournal : journal,
        pageId : "this-page",
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

    it("reports nothing after stop()", async () => {
        const t = setup([record("closed-page", NOW - HANG_JOURNAL_STALE_MS - 1)]);
        t.handle.stop();
        await vi.advanceTimersByTimeAsync(0);
        expect(t.events.emit).not.toHaveBeenCalled();
    });
});
