import { expect, inject } from "vitest";
import { createBrowserDeps, createNoopMeter, setupAllMonitors } from "@lag/core";
import { closePeerPage, environment, evaluateInPeerPage, openPeerPage } from "./commands.js";
import { wait } from "./harness.js";
import type { PeerEvent } from "./pages/peer-watch-page.js";

/**
 * The peer hang watch with the real BroadcastChannel and Web Locks API of
 * the browser. A peer page operates all monitors. It blocks its main thread
 * for 12 s, and the test closes it after 7 s, as a user closes a hung tab.
 * The engines end such a page in different ways (experiment E7):
 *
 * - Chromium, Safari on iOS and the WebKit build of Playwright for Windows
 *   stop the page. The monitors of the test page report the abandoned hang
 *   (`lag.hang.source: "peer"`).
 * - Firefox stops the blocked script, and Safari on macOS lets it continue
 *   until the end of the block. Then the page closes normally. It reports its own
 *   hang at its close (`lag.hang.source: "self"`), and the watch of the test
 *   page reports nothing.
 *
 * - The WebKit build of Playwright for Linux releases the lock of the page
 *   approximately 3 s after the close, but the page continues until the end
 *   of the block. Thus both pages report the hang there: a known double
 *   count of that build.
 *
 * In WebKit and Safari, these are the only ways to keep such a hang
 * (experiments E6 and E7).
 *
 * The test skips itself in Safari on iOS. Safari there operates only the
 * visible tab. When WebDriver goes back to the test page, the peer page
 * becomes hidden. If its block has not started yet, the page says "away" and
 * releases its lock, as a hidden page must. Thus WebDriver cannot make a hung
 * visible tab and a second tab that operates. `peer-tab.test.ts` measures how
 * Safari on iOS ends a closed page.
 */
type Emitted = { name : string; attributes : Record<string, unknown> };

const BLOCK_MS = 12_000;
/** The block of the peer page starts this long after `blockSoon()` (`pages/peer-watch-page.ts`). */
const BLOCK_DELAY_MS = 250;
const isHangOf = (pageId : string) => (event : Emitted) : boolean =>
    event.name === "lag.main_thread.hang" && event.attributes["lag.hang.page_id"] === pageId;

describe("the peer hang watch in a browser", () => {
    it("reports a page that closes during a hang: the other page reports it, or the page itself at its close", async (ctx) => {
        const env = environment();
        ctx.skip(env === "ios", "Safari on iOS operates only the visible tab: the peer page becomes hidden when the test page is visible again.");
        // Safari on iOS stops the page, as Chromium does
        const pageClosesNormally = env === "firefox" || env === "safari";
        const webKitOnLinux = env === "webkit" && inject("platform") === "linux";
        const fromTestPage : Emitted[] = [];
        const handles = setupAllMonitors({
            ...createBrowserDeps(window as never, {
                logger : { log : () => {} },
                meter : createNoopMeter(),
                events : { emit : (name, attributes) => fromTestPage.push({ name, attributes : { ...attributes } }) },
            }),
            pageId : "watcher",
        });
        const peerId = `peer-${Math.random().toString(36).slice(2)}`;
        const fromPeerPage : Emitted[] = [];
        const events = new BroadcastChannel("lag-test-events");
        events.onmessage = (message : MessageEvent<PeerEvent>) => {
            if (message.data.pageId === peerId) fromPeerPage.push(message.data);
        };
        const peer = await openPeerPage(`src/pages/peer-watch.html?id=${peerId}`);
        try {
            const peerViewId = await evaluateInPeerPage<string>(peer, "window.peerViewId");
            // The watch of the test page must see a heartbeat of the peer first
            await wait(1_500);
            await evaluateInPeerPage(peer, `window.blockSoon(${BLOCK_MS})`);
            const blockStart = Date.now() + BLOCK_DELAY_MS;
            // More than the hang threshold of 5 s
            await wait(7_000);
            const ownMainThreadOperated = Date.now() - blockStart < 10_000;
            await closePeerPage(peer);

            const peerReport = () : Emitted | undefined => fromTestPage.find(isHangOf(peerId));
            const selfReport = () : Emitted | undefined => fromPeerPage.find(isHangOf(peerId));
            const deadline = blockStart + BLOCK_MS + 10_000;
            const done = () : boolean => webKitOnLinux ? peerReport() !== undefined && selfReport() !== undefined : (pageClosesNormally ? selfReport() : peerReport()) !== undefined;
            while (Date.now() < deadline && !done()) await wait(500);
            // Time for a second report, which must not come
            await wait(1_500);
            console.log(`Peer hang watch (${env}): from the test page ${JSON.stringify(peerReport()?.attributes)}, from the closed page ${JSON.stringify(selfReport()?.attributes)}`);
            expect(ownMainThreadOperated).toBe(true);

            const expectReport = (report : Emitted | undefined, source : string) : void => {
                expect(report?.attributes).toEqual({
                    phase : "abandoned",
                    duration_ms : expect.any(Number),
                    "lag.hang.page_id" : peerId,
                    "lag.hang.source" : source,
                    "lag.page_view.id" : peerViewId,
                });
                // The duration starts at the last heartbeat before the block
                expect(report!.attributes["duration_ms"]).toBeGreaterThanOrEqual(5_000);
            };
            if (webKitOnLinux) {
                expectReport(peerReport(), "peer");
                expectReport(selfReport(), "self");
            } else if (pageClosesNormally) {
                expectReport(selfReport(), "self");
                expect(peerReport()).toBeUndefined();
            } else {
                expectReport(peerReport(), "peer");
                expect(selfReport()).toBeUndefined();
            }
        } finally {
            await closePeerPage(peer);
            events.close();
            handles.stop();
        }
    }, 60_000);
});
