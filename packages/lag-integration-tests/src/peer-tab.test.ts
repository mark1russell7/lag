import { expect, inject } from "vitest";
import { closePeerPage, environment, evaluateInPeerPage, openPeerPage, recordMeasurement } from "./commands.js";
import { wait } from "./harness.js";
import type { PeerHeartbeat } from "./pages/peer-page.js";

/**
 * Experiment E7: what can another page of the origin see of a hang? The test
 * page watches a peer page (`pages/peer.html`). The main thread and a worker
 * of the peer page send heartbeats through a BroadcastChannel, and the peer
 * page holds a Web Lock until it closes.
 *
 * The test page can be hidden: Chrome opens the peer page as a new tab in
 * the same window. Then the browser delays the timers of the test page to
 * approximately 1 s. Thus the measurements use the times of events (the
 * heartbeats and the lock), not the times of timers.
 *
 * The test page must operate during the block of the peer page. If it does
 * not, the two pages have one main thread, and the tests skip themselves.
 */
type Arrival = PeerHeartbeat & { arrivedAt : number };

const webKit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome\//.test(navigator.userAgent);
const engine = webKit ? "webkit" : /Firefox\//.test(navigator.userAgent) ? "firefox" : "chromium";

const BLOCK_MS = 4_000;
/** The block of the peer page starts this long after `blockSoon()` (`pages/peer-page.ts`). */
const BLOCK_DELAY_MS = 250;
const SHARED_THREAD_NOTE = "The test page did not operate during the block of the peer page: the two pages have one main thread.";

function listen(id : string) : { arrivals : Arrival[]; close() : void } {
    const arrivals : Arrival[] = [];
    const channel = new BroadcastChannel("lag-e7");
    channel.onmessage = (event : MessageEvent<PeerHeartbeat>) => {
        if (event.data.id === id) arrivals.push({ ...event.data, arrivedAt : Date.now() });
    };
    return { arrivals, close : () => channel.close() };
}

/** True when a heartbeat of `source` arrived in [from, to). */
function arrivedIn(arrivals : readonly Arrival[], source : PeerHeartbeat["source"], from : number, to : number) : boolean {
    return arrivals.some(arrival => arrival.source === source && arrival.arrivedAt >= from && arrival.arrivedAt < to);
}

/** The largest gap between consecutive times in [from, to]. */
function largestGap(times : readonly number[], from : number, to : number) : number {
    const inside = [from, ...times.filter(time => time > from && time < to), to];
    let largest = 0;
    for (let i = 1; i < inside.length; i++) largest = Math.max(largest, inside[i]! - inside[i - 1]!);
    return largest;
}

const lockName = (id : string) : string => `lag-e7:${id}`;

async function lockHeld(name : string) : Promise<boolean> {
    const state = await navigator.locks.query();
    return (state.held ?? []).some(lock => lock.name === name);
}

describe("experiment E7: another page of the origin watches a hang", () => {
    it("sees the silence of the main thread, while the lock of the page stays held", async (ctx) => {
        const id = `hang-${Math.random().toString(36).slice(2)}`;
        const heartbeats = listen(id);
        const peer = await openPeerPage(`src/pages/peer.html?id=${id}`);
        try {
            const visibility = document.visibilityState;
            await wait(1_000);
            await evaluateInPeerPage(peer, `window.blockSoon(${BLOCK_MS})`);
            const blockStart = Date.now() + BLOCK_DELAY_MS;
            // The lock checks during the block. A check also shows that the test page operates.
            const checks : { at : number; held : boolean }[] = [];
            while (Date.now() < blockStart + BLOCK_MS - 500) {
                await wait(200);
                checks.push({ at : Date.now(), held : await lockHeld(lockName(id)) });
            }
            const duringBlock = checks.filter(check => check.at > blockStart + 200 && check.at < blockStart + BLOCK_MS - 200);
            await wait(BLOCK_MS / 2 + 1_000);
            const end = Date.now();
            const gapOf = (source : PeerHeartbeat["source"]) : number =>
                largestGap(heartbeats.arrivals.filter(a => a.source === source).map(a => a.arrivedAt), blockStart - 500, end);
            const mainGap = gapOf("main");
            const workerGap = gapOf("worker");
            console.log(`E7 (${engine}, test page ${visibility}): main heartbeats gap ${mainGap} ms, worker heartbeats gap ${workerGap} ms, ` +
                `lock checks during the block ${duringBlock.map(check => String(check.held)).join(",")}`);
            ctx.skip(duringBlock.length === 0, SHARED_THREAD_NOTE);
            // A gap is a measurement only when the heartbeats of the source arrived before and after the block.
            // Without heartbeats, the gap is the full interval, and the checks below would pass for no reason.
            for (const source of ["main", "worker"] as const) {
                expect(arrivedIn(heartbeats.arrivals, source, blockStart - 1_000, blockStart), `${source} heartbeats before the block`).toBe(true);
                expect(arrivedIn(heartbeats.arrivals, source, blockStart + BLOCK_MS, end), `${source} heartbeats after the block`).toBe(true);
            }
            await recordMeasurement("peer-tab/main_heartbeat_gap", "ms", [mainGap], { engine });
            await recordMeasurement("peer-tab/worker_heartbeat_gap", "ms", [workerGap], { engine });

            // The main thread of the peer page sends nothing during the block
            expect(mainGap).toBeGreaterThan(BLOCK_MS - 500);
            // The BroadcastChannel of a worker waits for the main thread in WebKit, as the other output of a worker (E4, E6)
            if (webKit) expect(workerGap).toBeGreaterThan(BLOCK_MS - 500);
            else expect(workerGap).toBeLessThan(BLOCK_MS / 2);
            // The page holds its lock during the hang
            expect(duringBlock.every(check => check.held)).toBe(true);
        } finally {
            heartbeats.close();
            await closePeerPage(peer);
        }
    }, 40_000);

    /*
     * How the browser ends a page that the user closes during a hang:
     * - Chromium and the WebKit builds of Playwright stop the process. The
     *   lock comes free, and the page sends no pagehide.
     * - Firefox stops the blocked script. Then the page closes normally:
     *   it sends pagehide, and the lock comes free soon.
     * - Safari on macOS lets the blocked script continue until it ends, also
     *   for 90 s. Then the page closes normally. Safari on iOS stops the page
     *   (CI runs in the iOS Simulator).
     */
    it("gets the lock of a page that closes during a hang", async (ctx) => {
        const env = environment();
        const blockMs = inject("e7CloseBlockMs");
        const id = `close-${Math.random().toString(36).slice(2)}`;
        const heartbeats = listen(id);
        const peer = await openPeerPage(`src/pages/peer.html?id=${id}`);
        let grantedAt : number | undefined;
        try {
            await evaluateInPeerPage(peer, `window.blockSoon(${blockMs})`);
            const hangStart = Date.now() + BLOCK_DELAY_MS;
            const hangEnd = hangStart + blockMs;
            const granted = navigator.locks.request(lockName(id), () => { grantedAt = Date.now(); });
            await wait(2_000);
            // With one main thread, the wait ends only after the block
            const operatedDuringHang = Date.now() < hangEnd - 1_000;
            const grantedDuringHang = grantedAt !== undefined;
            const closed = await closePeerPage(peer);
            await Promise.race([granted, wait(Math.max(0, hangEnd - Date.now()) + 15_000)]);
            const pagehideAt = heartbeats.arrivals.find(a => a.source === "pagehide")?.arrivedAt;
            const after = (time : number | undefined) : string => time === undefined ? "never" : `${time - closed!.startedAt} ms`;
            console.log(`E7 (${env}): block ${blockMs} ms, granted during the hang ${grantedDuringHang}, close took ${closed!.endedAt - closed!.startedAt} ms, ` +
                `after the start of the close: lock granted ${after(grantedAt)}, pagehide ${after(pagehideAt)}, end of the block ${after(hangEnd)}`);
            ctx.skip(!operatedDuringHang, SHARED_THREAD_NOTE);

            // The channel of the peer page operated before the block: thus "no pagehide" below is a result, not a lost channel
            expect(arrivedIn(heartbeats.arrivals, "main", 0, hangStart)).toBe(true);
            expect(grantedDuringHang).toBe(false);
            expect(grantedAt).toBeDefined();
            await recordMeasurement("peer-tab/lock_granted_after_close", "ms", [grantedAt! - closed!.startedAt], { engine });
            if (env === "safari") {
                // The script continued until the end of the block, and then the page closed normally
                expect(grantedAt!).toBeGreaterThan(hangEnd - 1_000);
                expect(pagehideAt).toBeDefined();
            } else if (engine === "firefox") {
                expect(grantedAt! - closed!.startedAt).toBeLessThan(15_000);
                expect(pagehideAt).toBeDefined();
            } else {
                expect(grantedAt! - closed!.startedAt).toBeLessThan(15_000);
                expect(pagehideAt).toBeUndefined();
            }
        } finally {
            heartbeats.close();
            await closePeerPage(peer);
        }
    }, 60_000 + inject("e7CloseBlockMs"));
});
