/**
 * A second top-level page for `peer-hang-watch.test.ts`. It operates all
 * monitors of the library with the page ID of its URL (`?id=`), thus also
 * the peer hang watch. The test page watches it. The page sets
 * `window.peerReady` when it holds its Web Lock, and gives the ID of its
 * page view in `window.peerViewId`. It sends each event of its monitors to
 * the test page through the BroadcastChannel `lag-test-events`, because a
 * closing page can still send a message.
 */
import { createBrowserDeps, createNoopMeter, peerLockName, setupAllMonitors } from "@lag/core";

/** An event of the monitors of the peer page, as the test page gets it. */
export type PeerEvent = { pageId : string; name : string; attributes : Record<string, unknown> };

declare global {
    interface Window {
        peerReady? : boolean;
        peerViewId? : string | undefined;
        /**
         * This function blocks the main thread for `ms`, 250 ms after the call.
         * Thus the caller gets its answer before the block. In a CI run in
         * Safari, the answer to a script that started the block at once came
         * only after the block.
         */
        blockSoon? : (ms : number) => void;
    }
}

const pageId = new URLSearchParams(location.search).get("id") ?? "peer";
const events = new BroadcastChannel("lag-test-events");
const handles = setupAllMonitors({
    ...createBrowserDeps(window as never, {
        logger : { log : () => {} },
        meter : createNoopMeter(),
        events : { emit : (name, attributes) => events.postMessage({ pageId, name, attributes : { ...attributes } } satisfies PeerEvent) },
    }),
    pageId,
});
window.peerViewId = handles.vitals?.getView().id;

/** The block starts this long after `blockSoon()`. The tests add it to the start of the block. */
const BLOCK_DELAY_MS = 250;

window.blockSoon = (ms) => {
    setTimeout(() => {
        const start = performance.now();
        while (performance.now() - start < ms) {
            // busy wait
        }
    }, BLOCK_DELAY_MS);
};

// The page is ready when the watch holds the lock of the page
const waitForLock = async () : Promise<void> => {
    const state = await navigator.locks.query();
    if ((state.held ?? []).some(lock => lock.name === peerLockName(pageId))) window.peerReady = true;
    else setTimeout(() => void waitForLock(), 50);
};
void waitForLock();
