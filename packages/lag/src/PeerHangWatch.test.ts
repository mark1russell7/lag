import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isPeerMessage, PEER_CHANNEL_NAME, PeerHangWatch, peerLockName, type PeerHangWatchOptions } from "./PeerHangWatch.js";
import { SimulatedOrigin, type SimulatedPage } from "./test-peers.js";
import { createMemoryHangJournal, type HangRecord } from "./hang-journal.js";

type Watched = { page : SimulatedPage; watch : PeerHangWatch; hangs : HangRecord[]; sources : string[] };

let origin : SimulatedOrigin;
let watches : PeerHangWatch[];

beforeEach(() => {
    vi.useFakeTimers({ now : 1_000_000 });
    origin = new SimulatedOrigin();
    watches = [];
});

afterEach(() => {
    for (const watch of watches) watch.stop();
    vi.useRealTimers();
});

function open(pageId : string, options : Partial<PeerHangWatchOptions> = {}) : Watched {
    const page = origin.page();
    const hangs : HangRecord[] = [];
    const sources : string[] = [];
    const watch = new PeerHangWatch(page.deps(), {
        pageId,
        visible : true,
        onAbandonedHang : (hang, source) => { hangs.push(hang); sources.push(source); },
        ...options,
    });
    watches.push(watch);
    return { page, watch, hangs, sources };
}

/** Another page of the origin that records the messages of the watch. */
function listen() : { messages : Array<{ type : string; pageId : string }>; close() : void } {
    const messages : Array<{ type : string; pageId : string }> = [];
    const channel = new (origin.page().deps().BroadcastChannel)("lag-peer-hang-watch");
    channel.onmessage = (event) => messages.push(event.data as { type : string; pageId : string });
    return { messages, close : () => channel.close() };
}

const advance = async (ms : number) : Promise<void> => { await vi.advanceTimersByTimeAsync(ms); };

describe("PeerHangWatch", () => {
    it("uses the channel name and the lock names of the protocol, which pages of other versions also use", async () => {
        expect(PEER_CHANNEL_NAME).toBe("lag-peer-hang-watch");
        expect(peerLockName("x")).toBe("lag-page:x");
        const heard = listen();
        open("a");
        await advance(10);
        expect(heard.messages).toEqual([{ type : "beat", pageId : "a", sentAt : Date.now() - 10, attributes : {} }]);
        heard.close();
    });

    it("sends a heartbeat when it gets its lock, then one each interval, and none after it becomes hidden", async () => {
        const heard = listen();
        const a = open("a", { beatIntervalMs : 1_000 });
        await advance(2_500);
        expect(heard.messages.map(m => m.type)).toEqual(["beat", "beat", "beat"]);
        a.watch.hide();
        await advance(3_000);
        expect(heard.messages.map(m => m.type)).toEqual(["beat", "beat", "beat", "away"]);
        heard.close();
    });

    it("says away only when it was visible", async () => {
        const heard = listen();
        const a = open("a", { visible : false });
        a.watch.hide();
        a.watch.stop();
        a.watch.hide();
        await advance(2_000);
        expect(heard.messages).toEqual([]);
        expect(a.page.logs).toEqual([]);
        heard.close();
    });

    it("reports a page that hangs after its first heartbeat", async () => {
        const a = open("a");
        const b = open("b");
        await advance(10);
        b.page.hang();
        await advance(8_000);
        b.page.kill();
        await advance(2_000);
        expect(a.hangs.map(hang => hang.pageId)).toEqual(["b"]);
    });

    it("waits 1 s by default for a late message of a page", async () => {
        origin.messageDelayMs = 500;
        const a = open("a");
        const b = open("b");
        await advance(1_500);
        b.page.hang();
        await advance(8_000);
        // The page recovers and closes: its "away" arrives 500 ms after its lock comes free
        b.page.recover();
        b.watch.stop();
        await advance(3_000);
        expect(a.hangs).toEqual([]);
    });

    it("reports the page when the wait is shorter than the delay of its last message", async () => {
        origin.messageDelayMs = 500;
        const a = open("a", { graceMs : 100 });
        const b = open("b");
        await advance(1_500);
        b.page.hang();
        await advance(8_000);
        b.page.recover();
        b.watch.stop();
        await advance(3_000);
        expect(a.hangs.map(hang => hang.pageId)).toEqual(["b"]);
    });

    it("stops all its timers and closes its channel", async () => {
        const a = open("a");
        const b = open("b");
        await advance(1_500);
        b.page.hang();
        await advance(8_000);
        b.page.kill();
        b.watch.stop();
        // a waits for the last messages of b now
        await advance(100);
        expect(vi.getTimerCount()).toBe(2);
        a.watch.stop();
        expect(vi.getTimerCount()).toBe(0);
        expect(origin.openChannels(a.page)).toBe(0);
    });

    it("starts no wait for a page that ends after the stop", async () => {
        const a = open("a");
        const b = open("b");
        await advance(1_500);
        b.page.hang();
        await advance(8_000);
        a.watch.stop();
        b.page.kill();
        b.watch.stop();
        await advance(10);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("holds the lock of a visible page, and releases it when the page becomes hidden", async () => {
        const a = open("a");
        await advance(10);
        expect(origin.heldBy(a.page)).toEqual([peerLockName("a")]);

        a.watch.hide();
        await advance(10);
        expect(origin.heldBy(a.page)).toEqual([]);

        a.watch.show();
        await advance(10);
        expect(origin.heldBy(a.page)).toEqual([peerLockName("a")]);
    });

    it("reports a page that closes during a hang, with the time of its last heartbeat", async () => {
        const a = open("a");
        const b = open("b");
        b.watch.setContext({ "lag.page_view.id" : "view-b" });
        await advance(2_500);
        const lastBeat = Date.now() - 500;

        b.page.hang();
        await advance(8_000);
        expect(a.hangs).toEqual([]);

        b.page.kill();
        const killedAt = Date.now();
        await advance(1_500);
        expect(a.hangs).toEqual([{ pageId : "b", startedAt : lastBeat, lastSeenAt : killedAt, attributes : { "lag.page_view.id" : "view-b" } }]);
    });

    it("reports nothing when the page survives its hang", async () => {
        const a = open("a");
        const b = open("b");
        await advance(1_500);
        b.page.hang();
        await advance(8_000);
        b.page.recover();
        await advance(3_000);
        b.watch.stop();
        await advance(3_000);
        expect(a.hangs).toEqual([]);
    });

    it("reports nothing when a page closes or becomes hidden normally", async () => {
        const a = open("a");
        const b = open("b");
        const c = open("c");
        await advance(1_500);
        b.watch.stop();
        c.watch.hide();
        await advance(10_000);
        expect(a.hangs).toEqual([]);
    });

    it("reports nothing when a page ends soon after its last heartbeat (a crash, not a hang)", async () => {
        const a = open("a");
        const b = open("b");
        await advance(1_500);
        b.page.hang();
        await advance(3_000);
        b.page.kill();
        await advance(3_000);
        expect(a.hangs).toEqual([]);
    });

    it("reports a hang of 5 s or more, and nothing for a shorter silence", async () => {
        const a = open("a", { thresholdMs : 5_000 });
        const b = open("b");
        const c = open("c");
        await advance(1_000);
        b.page.hang();
        c.page.hang();
        await advance(4_000);
        // The last heartbeat of b was 4 s ago
        b.page.kill();
        await advance(1_000);
        // The last heartbeat of c was 5 s ago
        c.page.kill();
        await advance(2_000);
        expect(a.hangs.map(hang => hang.pageId)).toEqual(["c"]);
    });

    it("lets one page only report a hang, when many pages watch it", async () => {
        const a = open("a");
        const b = open("b");
        const c = open("c");
        const d = open("d");
        await advance(1_500);
        d.page.hang();
        await advance(8_000);
        d.page.kill();
        await advance(3_000);
        expect([...a.hangs, ...b.hangs, ...c.hangs].map(hang => hang.pageId)).toEqual(["d"]);
        // The other pages do not report the hang again when the reporter stops
        const reporter = [a, b, c].find(page => page.hangs.length === 1)!;
        reporter.watch.stop();
        await advance(3_000);
        expect([...a.hangs, ...b.hangs, ...c.hangs].map(hang => hang.pageId)).toEqual(["d"]);
    });

    it("waits for the last messages of a page after its lock comes free", async () => {
        const a = open("a", { graceMs : 1_000 });
        const b = open("b");
        await advance(1_500);
        b.page.hang();
        await advance(8_000);
        // The page recovers, and closes at once: its "away" message can arrive after its lock
        b.page.recover();
        b.watch.stop();
        await advance(3_000);
        expect(a.hangs).toEqual([]);
    });

    it("takes the record of the worker of the hung page from the journal", async () => {
        const journal = createMemoryHangJournal();
        const a = open("a", { journal });
        const b = open("b");
        await advance(1_500);
        b.page.hang();
        const record = { pageId : "b", startedAt : Date.now() - 200, lastSeenAt : Date.now() + 6_000, attributes : { "lag.page_view.id" : "view-b" } };
        await journal.put(record);
        await advance(8_000);
        b.page.kill();
        await advance(2_000);
        expect(a.hangs).toEqual([record]);
        expect(await journal.list()).toEqual([]);
    });

    it("uses its own times when the journal fails", async () => {
        const journal = { ...createMemoryHangJournal(), take : () => Promise.reject(new Error("no IndexedDB")) };
        const a = open("a", { journal });
        const b = open("b");
        await advance(1_500);
        b.page.hang();
        await advance(8_000);
        b.page.kill();
        await advance(2_000);
        expect(a.hangs.map(hang => hang.pageId)).toEqual(["b"]);
    });

    it("watches the others while hidden, but sends no heartbeat and holds no lock", async () => {
        const a = open("a", { visible : false });
        const b = open("b");
        await advance(1_500);
        expect(origin.heldBy(a.page)).toEqual([]);
        b.page.hang();
        await advance(8_000);
        b.page.kill();
        await advance(2_000);
        expect(a.hangs.map(hang => hang.pageId)).toEqual(["b"]);
        expect(b.hangs).toEqual([]);
    });

    it("watches a page again after it becomes visible again", async () => {
        const a = open("a");
        const b = open("b");
        await advance(1_500);
        b.watch.hide();
        await advance(3_000);
        b.watch.show();
        await advance(1_500);
        b.page.hang();
        await advance(8_000);
        b.page.kill();
        await advance(2_000);
        expect(a.hangs.map(hang => hang.pageId)).toEqual(["b"]);
    });

    it("does not use a lock that it got after the page became hidden again", async () => {
        const a = open("a");
        a.watch.hide();
        a.watch.show();
        a.watch.hide();
        await advance(10);
        expect(origin.heldBy(a.page)).toEqual([]);
    });

    it("stops: it says away, releases its locks, and reports nothing more", async () => {
        const a = open("a");
        const b = open("b");
        await advance(1_500);
        b.page.hang();
        await advance(8_000);
        a.watch.stop();
        a.watch.stop();
        b.page.kill();
        await advance(3_000);
        expect(a.hangs).toEqual([]);
        expect(origin.heldBy(a.page)).toEqual([]);
        // After the stop, show() and hide() do nothing
        a.watch.show();
        a.watch.hide();
        await advance(10);
        expect(origin.heldBy(a.page)).toEqual([]);
    });

    it("reports nothing when it stops while it waits for the last messages of a page", async () => {
        const a = open("a", { graceMs : 1_000 });
        const b = open("b");
        await advance(1_500);
        b.page.hang();
        await advance(8_000);
        b.page.kill();
        await advance(100);
        a.watch.stop();
        await advance(3_000);
        expect(a.hangs).toEqual([]);
        expect(origin.heldBy(a.page)).toEqual([]);
    });

    it("releases the claim when it stops", async () => {
        const a = open("a");
        const b = open("b");
        await advance(1_500);
        b.page.hang();
        await advance(8_000);
        b.page.kill();
        await advance(2_000);
        expect(origin.heldBy(a.page)).toContain("lag-page-claim:b");
        a.watch.stop();
        await advance(10);
        expect(origin.heldBy(a.page)).toEqual([]);
    });

    it("ignores messages that are not its own, and its own messages", async () => {
        const a = open("a");
        const page = origin.page();
        const other = new (page.deps().BroadcastChannel)(PEER_CHANNEL_NAME);
        for (const message of [null, 3, "beat", { type : "beat", pageId : "x", sentAt : 1 }, { type : "beat", pageId : "x", sentAt : Number.NaN, attributes : {} },
            { type : "beat", pageId : "x", sentAt : 1, attributes : { n : 1 } }, { type : "other", pageId : "x", sentAt : 1 }, { type : "away", pageId : 5, sentAt : 1 },
            // An "away" of a page that the watch does not know
            { type : "away", pageId : "y", sentAt : 1 },
            { type : "beat", pageId : "a", sentAt : 1, attributes : {} }]) {
            other.postMessage(message);
        }
        await advance(10_000);
        expect(origin.heldBy(a.page)).toEqual([peerLockName("a")]);
        // The watch did not take its own beat as the beat of another page: it does not wait for its own lock
        a.watch.hide();
        await advance(3_000);
        expect(origin.heldBy(a.page)).toEqual([]);
        expect(a.hangs).toEqual([]);
        other.close();
    });

    it("logs a failed lock request and a failed message, and continues", async () => {
        const page = origin.page();
        const deps = page.deps();
        const failing = new PeerHangWatch({
            ...deps,
            locks : { request : () => Promise.reject(new Error("SecurityError")) },
        }, { pageId : "f", visible : true, onAbandonedHang : () => {} });
        const throwing = new PeerHangWatch({
            ...deps,
            locks : { request : () => { throw new Error("SecurityError"); } },
        }, { pageId : "g", visible : true, onAbandonedHang : () => {} });
        await advance(10);
        failing.stop();
        // A message after the close of the channel fails
        throwing.stop();
        expect(page.logs).toEqual(["debug: A Web Lock request failed.", "debug: A Web Lock request failed."]);
        // The request that throws logs at once, the request that rejects logs after a microtask
        expect(page.logAttributes).toEqual([
            { error : expect.any(Error), name : "lag-page:g", type : "PeerHangWatch" },
            { error : expect.any(Error), name : "lag-page:f", type : "PeerHangWatch" },
        ]);
    });

    it("logs a message that the channel cannot send", async () => {
        const page = origin.page();
        const deps = page.deps();
        const watch = new PeerHangWatch({
            ...deps,
            BroadcastChannel : class {
                onmessage = null;
                postMessage() : void { throw new Error("DataCloneError"); }
                close() : void {}
            },
        }, { pageId : "h", visible : true, onAbandonedHang : () => {} });
        await advance(1_500);
        watch.stop();
        expect(page.logs).toContain("debug: Could not send a message to the other pages.");
        expect(page.logAttributes[page.logs.indexOf("debug: Could not send a message to the other pages.")]).toEqual({ error : expect.any(Error), type : "PeerHangWatch" });
    });
});

describe("PeerHangWatch, the own page at its close", () => {
    it("reports its own hang when it closes at the end of a hang, as in Safari", async () => {
        const a = open("a");
        a.watch.setContext({ "lag.page_view.id" : "view-a" });
        await advance(1_500);
        const lastBeat = Date.now() - 500;
        a.page.hang();
        await advance(8_000);
        // The script ends, and the next task is the close: no heartbeat in between
        a.page.recover();
        a.watch.hide(true);
        expect(a.hangs).toEqual([{ pageId : "a", startedAt : lastBeat, lastSeenAt : Date.now(), attributes : { "lag.page_view.id" : "view-a" } }]);
        expect(a.sources).toEqual(["self"]);
    });

    it("reports its own hang when a heartbeat comes between the hang and the close, as in Firefox", async () => {
        const a = open("a");
        await advance(1_500);
        const lastBeatBefore = Date.now() - 500;
        a.page.hang();
        await advance(8_200);
        a.page.recover();
        // The heartbeat that was due during the hang comes first, and then the close
        await advance(400);
        a.watch.hide(true);
        expect(a.hangs.map(hang => [hang.startedAt, hang.lastSeenAt])).toEqual([[lastBeatBefore, Date.now()]]);
        expect(a.sources).toEqual(["self"]);
    });

    it("reports nothing at a normal close, or at a close some time after a hang", async () => {
        const a = open("a");
        await advance(3_000);
        a.watch.hide(true);
        const b = open("b");
        await advance(1_500);
        b.page.hang();
        await advance(8_000);
        b.page.recover();
        // Two regular heartbeats after the hang
        await advance(2_100);
        b.watch.hide(true);
        expect([...a.hangs, ...b.hangs]).toEqual([]);
    });

    it("reports nothing that the worker monitor counted already", async () => {
        const a = open("a");
        await advance(1_500);
        a.page.hang();
        await advance(8_000);
        a.page.recover();
        a.watch.noteHangEnded();
        a.watch.hide(true);
        expect(a.hangs).toEqual([]);
    });

    it("reports a later hang, also after the worker monitor counted an earlier one", async () => {
        const a = open("a");
        await advance(1_500);
        a.watch.noteHangEnded();
        await advance(1_000);
        a.page.hang();
        await advance(8_000);
        a.page.recover();
        a.watch.hide(true);
        expect(a.sources).toEqual(["self"]);
    });

    it("reports nothing when it becomes hidden, or when it closes while hidden or before its first heartbeat", async () => {
        const a = open("a");
        await advance(1_500);
        a.page.hang();
        await advance(8_000);
        a.page.recover();
        // Without the argument, the page does not close
        a.watch.hide();
        a.watch.hide(true);
        // Visible again, and closed before the lock and the first heartbeat
        a.watch.show();
        a.watch.hide(true);
        expect(a.hangs).toEqual([]);
    });

    it("measures the gaps again after the page was hidden", async () => {
        const a = open("a");
        await advance(1_500);
        a.watch.hide();
        await advance(10_000);
        a.watch.show();
        await advance(10);
        a.watch.hide(true);
        expect(a.hangs).toEqual([]);
    });

    it("reports a silence of exactly the threshold", async () => {
        const a = open("a", { thresholdMs : 5_000 });
        // The heartbeats come at 0 ms, 1000 ms, ...
        await advance(1_000);
        a.page.hang();
        await advance(5_000);
        a.page.recover();
        a.watch.hide(true);
        expect(a.sources).toEqual(["self"]);
    });

    it("reports a gap of exactly the threshold before the last heartbeat", async () => {
        const a = open("a", { thresholdMs : 5_000 });
        await advance(1_000);
        a.page.hang();
        await advance(4_500);
        a.page.recover();
        // The heartbeat at 6000 ms comes 5000 ms after the heartbeat at 1000 ms
        await advance(500);
        a.watch.hide(true);
        expect(a.sources).toEqual(["self"]);
    });

    it("reports nothing when the page operated for a heartbeat interval after the gap", async () => {
        const a = open("a", { beatIntervalMs : 1_000 });
        await advance(1_500);
        a.page.hang();
        await advance(8_000);
        a.page.recover();
        // The heartbeat after the gap comes at 10 000 ms. Then a short block without a heartbeat.
        await advance(500);
        a.page.hang();
        await advance(1_200);
        a.page.recover();
        a.watch.hide(true);
        expect(a.hangs).toEqual([]);
    });

    it("reports nothing for a close exactly one heartbeat interval after the heartbeat that ended the gap", async () => {
        const a = open("a", { beatIntervalMs : 1_000 });
        await advance(1_000);
        a.page.hang();
        await advance(5_500);
        a.page.recover();
        // The heartbeat after the gap comes at 7000 ms. Then a block hides the next heartbeat.
        await advance(500);
        a.page.hang();
        await advance(1_000);
        a.page.recover();
        a.watch.hide(true);
        expect(a.hangs).toEqual([]);
    });

    it("counts a hang that the worker monitor counted at the time of the last heartbeat as counted", async () => {
        const a = open("a");
        await advance(1_000);
        a.watch.noteHangEnded();
        a.page.hang();
        await advance(8_000);
        a.page.recover();
        a.watch.hide(true);
        expect(a.hangs).toEqual([]);
    });

    it("reports nothing for a gap of less than the threshold", async () => {
        const a = open("a", { thresholdMs : 5_000 });
        await advance(1_500);
        a.page.hang();
        await advance(3_400);
        a.page.recover();
        a.watch.hide(true);
        expect(a.hangs).toEqual([]);
    });
});

describe("isPeerMessage", () => {
    it("accepts the two messages of the watch", () => {
        expect(isPeerMessage({ type : "beat", pageId : "a", sentAt : 1, attributes : { k : "v" } })).toBe(true);
        expect(isPeerMessage({ type : "away", pageId : "a", sentAt : 1 })).toBe(true);
    });

    it("refuses other values", () => {
        expect(isPeerMessage(undefined)).toBe(false);
        expect(isPeerMessage({ type : "beat", pageId : "a", sentAt : 1, attributes : null })).toBe(false);
        expect(isPeerMessage({ type : "beat", pageId : "a", sentAt : Infinity, attributes : {} })).toBe(false);
        expect(isPeerMessage({ type : "away", pageId : "a" })).toBe(false);
        expect(isPeerMessage({ type : "away", pageId : 1, sentAt : 1 })).toBe(false);
        expect(isPeerMessage({ type : "away", pageId : "a", sentAt : "1" })).toBe(false);
        expect(isPeerMessage({ type : "away", pageId : "a", sentAt : Number.NaN })).toBe(false);
        expect(isPeerMessage({ type : "other", pageId : "a", sentAt : 1, attributes : {} })).toBe(false);
    });
});
