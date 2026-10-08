import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstrumentedPeerHangWatch } from "./peer-hang-watch.js";
import { createRecordingMeter, expectCatalogEvents, expectCatalogInstruments } from "../test-utils.js";
import { createFakeLifecycle } from "../vitals/test-fakes.js";
import { SimulatedOrigin, type SimulatedPage } from "../test-peers.js";
import { createMemoryHangJournal } from "../hang-journal.js";
import { peerLockName } from "../PeerHangWatch.js";

let origin : SimulatedOrigin;

beforeEach(() => {
    vi.useFakeTimers({ now : 1_700_000_000_000 });
    origin = new SimulatedOrigin();
});

afterEach(() => vi.useRealTimers());

function open(pageId : string | undefined, visibility : "visible" | "hidden" = "visible", extra : Record<string, unknown> = {}) {
    const page : SimulatedPage = origin.page();
    const fake = createFakeLifecycle(visibility);
    const meter = createRecordingMeter();
    const events = { emit : vi.fn() };
    const handle = createInstrumentedPeerHangWatch({
        ...page.deps(),
        meter : meter.meter,
        events,
        ...(pageId ? { pageId } : {}),
        ...extra,
    }, fake.lifecycle);
    return { page, fake, meter, events, handle };
}

describe("createInstrumentedPeerHangWatch", () => {
    it("records a page that closed during a hang as an abandoned hang, with the context of that page", async () => {
        const a = open("a");
        const b = open("b");
        b.handle.monitor!.setContext({ "lag.page_view.id" : "view-b", "session.id" : "s1" });
        await vi.advanceTimersByTimeAsync(1_500);
        b.page.hang();
        await vi.advanceTimersByTimeAsync(7_500);
        b.page.kill();
        await vi.advanceTimersByTimeAsync(2_000);

        expect(a.meter.records().get("lag_main_thread_hangs")).toEqual([{ value : 1, attributes : { outcome : "abandoned" } }]);
        expect(a.meter.records().get("lag_main_thread_hang_duration_histogram")).toEqual([{ value : 8_000, attributes : { outcome : "abandoned" } }]);
        expect(a.events.emit).toHaveBeenCalledWith("lag.main_thread.hang", {
            phase : "abandoned",
            duration_ms : 8_000,
            "lag.hang.page_id" : "b",
            "lag.hang.source" : "peer",
            "lag.page_view.id" : "view-b",
            "session.id" : "s1",
        });
        expectCatalogInstruments(a.meter);
        expectCatalogEvents(a.events.emit, ["session.id"]);
        a.handle.stop();
        b.handle.stop();
    });

    it("takes the record of the worker from the hang journal", async () => {
        const journal = createMemoryHangJournal();
        const a = open("a", "visible", { hangJournal : journal });
        const b = open("b");
        await vi.advanceTimersByTimeAsync(1_500);
        b.page.hang();
        await journal.put({ pageId : "b", startedAt : Date.now() - 100, lastSeenAt : Date.now() + 6_000, attributes : {} });
        await vi.advanceTimersByTimeAsync(7_500);
        b.page.kill();
        await vi.advanceTimersByTimeAsync(2_000);
        expect(a.meter.records().get("lag_main_thread_hang_duration_histogram")).toEqual([{ value : 6_100, attributes : { outcome : "abandoned" } }]);
        expect(await journal.list()).toEqual([]);
        a.handle.stop();
    });

    it("holds the lock only while the page is visible", async () => {
        const a = open("a", "hidden");
        await vi.advanceTimersByTimeAsync(10);
        expect(origin.heldBy(a.page)).toEqual([]);

        a.fake.setVisibility("visible");
        await vi.advanceTimersByTimeAsync(10);
        expect(origin.heldBy(a.page)).toEqual([peerLockName("a")]);

        a.fake.setVisibility("hidden");
        await vi.advanceTimersByTimeAsync(10);
        expect(origin.heldBy(a.page)).toEqual([]);

        // A page that goes into the back/forward cache releases its lock and closes its channel.
        // After the restore, it opens the channel and takes the lock again.
        a.fake.setVisibility("visible");
        await vi.advanceTimersByTimeAsync(10);
        a.fake.pagehide(true);
        await vi.advanceTimersByTimeAsync(10);
        expect(origin.heldBy(a.page)).toEqual([]);
        expect(origin.openChannels(a.page)).toBe(0);
        a.fake.pageshow(true);
        await vi.advanceTimersByTimeAsync(10);
        expect(origin.heldBy(a.page)).toEqual([peerLockName("a")]);
        expect(origin.openChannels(a.page)).toBe(1);

        a.handle.stop();
        await vi.advanceTimersByTimeAsync(10);
        expect(origin.heldBy(a.page)).toEqual([]);
        // After the stop, the lifecycle has no effect
        a.fake.setVisibility("hidden");
        a.fake.setVisibility("visible");
        await vi.advanceTimersByTimeAsync(10);
        expect(origin.heldBy(a.page)).toEqual([]);
    });

    it("records the hang without an event sink, and stops listening to the lifecycle", async () => {
        const page = origin.page();
        const fake = createFakeLifecycle();
        const unsubscribe = vi.fn();
        const subscribe = fake.lifecycle.subscribe.bind(fake.lifecycle);
        vi.spyOn(fake.lifecycle, "subscribe").mockImplementation((listener) => {
            const stop = subscribe(listener);
            return () => { unsubscribe(); stop(); };
        });
        const meter = createRecordingMeter();
        const b = createInstrumentedPeerHangWatch({ ...page.deps(), clock : { now : () => 0 }, meter : meter.meter, pageId : "b" }, fake.lifecycle);
        const c = open("c");
        await vi.advanceTimersByTimeAsync(1_500);
        c.page.hang();
        await vi.advanceTimersByTimeAsync(7_500);
        c.page.kill();
        await vi.advanceTimersByTimeAsync(2_000);
        expect(meter.records().get("lag_main_thread_hangs")).toEqual([{ value : 1, attributes : { outcome : "abandoned" } }]);
        // The report completed: the page keeps the claim, and logged no error
        expect(origin.heldBy(page)).toContain("lag-page-claim:c");
        expect(page.logs).toEqual([]);
        b.stop();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it("records the hang of its own page with the source self, when the page closes at the end of a hang", async () => {
        const a = open("a");
        a.handle.monitor!.setContext({ "lag.page_view.id" : "view-a" });
        await vi.advanceTimersByTimeAsync(1_500);
        a.page.hang();
        await vi.advanceTimersByTimeAsync(7_500);
        a.page.recover();
        a.fake.pagehide(false);
        expect(a.events.emit).toHaveBeenCalledWith("lag.main_thread.hang", {
            phase : "abandoned",
            duration_ms : 8_000,
            "lag.hang.page_id" : "a",
            "lag.hang.source" : "self",
            "lag.page_view.id" : "view-a",
        });
        expect(a.meter.records().get("lag_main_thread_hangs")).toEqual([{ value : 1, attributes : { outcome : "abandoned" } }]);
        a.handle.stop();
    });

    it("does not record a hang when the page goes into the back/forward cache", async () => {
        const a = open("a");
        await vi.advanceTimersByTimeAsync(1_500);
        a.page.hang();
        await vi.advanceTimersByTimeAsync(7_500);
        a.page.recover();
        a.fake.pagehide(true);
        expect(a.events.emit).not.toHaveBeenCalled();
        a.handle.stop();
    });

    it("makes a page ID when it gets none", async () => {
        const a = open(undefined);
        await vi.advanceTimersByTimeAsync(10);
        expect(origin.heldBy(a.page)).toEqual([expect.stringMatching(/^lag-page:[0-9a-f]{32}$/)]);
        a.handle.stop();
    });

    it("gives an empty handle when the construction fails", () => {
        const log = vi.fn();
        const fake = createFakeLifecycle();
        const handle = createInstrumentedPeerHangWatch({
            ...origin.page().deps(),
            BroadcastChannel : class { constructor() { throw new Error("no BroadcastChannel"); } } as never,
            logger : { log },
            clock : { now : () => 0 },
            meter : createRecordingMeter().meter,
        }, fake.lifecycle);
        expect(handle.monitor).toBeUndefined();
        expect(log).toHaveBeenCalledWith("warn", "Failed to create the \"peer-hang-watch\" monitor.", expect.anything());
        handle.stop();
    });
});
