import { createBrowserDeps, createNoopMeter, peerLockName, PEER_CHANNEL_NAME, setupAllMonitors } from "@mark1russell7/lag";
import { closePeerPage, evaluateInPeerPage, leaveAndReturnToPeerPage, openPeerPage } from "../commands.js";
import { wait } from "../harness.js";
import type { BackForwardResult } from "../command-types.js";

/**
 * The back/forward cache of Chromium, with the library in two pages of the
 * origin. Chrome removes a page from the cache when a BroadcastChannel
 * message arrives for it (the reason "broadcastchannel-message"). The peer
 * hang watch of each visible page sends a heartbeat each second. Thus a
 * page in the cache closes the channel of its watch.
 *
 * Playwright turns off the cache in Chromium by default. This project
 * removes the switch `--disable-back-forward-cache`. While the peer page is
 * away, the test page sends messages on the channel of the watch, thus the
 * result does not depend on the visibility of the test page.
 */
const AWAY_MS = 3_000;

/**
 * Chromium can also remove a page from the cache for other reasons, for
 * example memory pressure. In CI, the page got such a reason one time, as
 * "masked". After such a reason, the test tries again. A reason that the
 * watch can cause fails the test at once: a message on its channel, a held
 * lock, or an open channel in an engine that does not cache such a page.
 */
const ATTEMPTS = 3;
const REASONS_OF_THE_WATCH = ["BroadcastChannelOnMessage", "WebLocks", "BroadcastChannel"];

/** This function sends a message on the channel of the watch each 200 ms. The watches ignore it. */
function sendMessages() : () => void {
    const channel = new BroadcastChannel(PEER_CHANNEL_NAME);
    const timer = setInterval(() => channel.postMessage({ type : "lag-test" }), 200);
    return () => {
        clearInterval(timer);
        channel.close();
    };
}

describe("the back/forward cache with the peer hang watch", () => {
    it("removes a page with an open channel of the watch from the cache: the check of this test operates", async () => {
        const peer = await openPeerPage("lag-channel-only.html");
        const stopMessages = sendMessages();
        try {
            const result = await leaveAndReturnToPeerPage(peer, "lag-away.html", AWAY_MS);
            expect(result.restored).toBe(false);
            expect(result.reasons).toEqual(["broadcastchannel-message"]);
            expect(result.explanations.map(explanation => explanation.reason)).toContain("BroadcastChannelOnMessage");
        } finally {
            stopMessages();
            await closePeerPage(peer);
        }
    });

    it("keeps a page with the library in the cache, and the page watches again after the restore", async () => {
        const handles = setupAllMonitors({
            ...createBrowserDeps(window as never, { logger : { log : () => {} }, meter : createNoopMeter() }),
            pageId : "watcher",
        });
        const peerId = `peer-${Math.random().toString(36).slice(2)}`;
        // The page of the public folder: the page of `src/pages` has the WebSocket of the Vite client
        const peer = await openPeerPage(`lag-peer-watch.html?id=${peerId}`);
        const stopMessages = sendMessages();
        try {
            // The watch of the peer page must see a heartbeat of the test page first
            await wait(1_500);
            const results : BackForwardResult[] = [];
            for (let attempt = 0; attempt < ATTEMPTS && !results.at(-1)?.restored; attempt++) {
                const result = await leaveAndReturnToPeerPage(peer, "lag-away.html", AWAY_MS);
                expect(result.explanations.filter(explanation => REASONS_OF_THE_WATCH.includes(explanation.reason)), JSON.stringify(result)).toEqual([]);
                results.push(result);
            }
            expect(results.at(-1)?.restored, JSON.stringify(results)).toBe(true);

            // After the restore, the page is visible again: it takes its lock again
            await expect.poll(
                () => evaluateInPeerPage<string[]>(peer, "navigator.locks.query().then(state => (state.held ?? []).map(lock => lock.name))"),
                { timeout : 5_000 },
            ).toContain(peerLockName(peerId));
        } finally {
            stopMessages();
            await closePeerPage(peer);
            handles.stop();
        }
    });
});
