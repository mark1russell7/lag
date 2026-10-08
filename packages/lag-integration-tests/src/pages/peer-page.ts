/**
 * A second top-level page for experiment E7 (`peer-tab.test.ts`). A server
 * command opens it. The page holds a Web Lock (`lag-e7:<id>`) until it
 * closes. Its main thread and a dedicated worker each send a heartbeat
 * through the BroadcastChannel `lag-e7` each 100 ms. Thus another page of the
 * origin can see when the main thread or the worker stops, and when the
 * page closes.
 */
/** A heartbeat of the main thread or of the worker, or the `pagehide` event of the page. */
export type PeerHeartbeat = { id : string; source : "main" | "worker" | "pagehide"; sentAt : number };

declare global {
    interface Window {
        peerReady? : boolean;
        /**
         * This function blocks the main thread for `ms`, 250 ms after the call.
         * Thus the caller gets its answer before the block. In a CI run in
         * Safari, the answer to a script that started the block at once came
         * only after the block.
         */
        blockSoon? : (ms : number) => void;
    }
}

const HEARTBEAT_MS = 100;
const id = new URLSearchParams(location.search).get("id") ?? "peer";
const channel = new BroadcastChannel("lag-e7");

setInterval(() => channel.postMessage({ id, source : "main", sentAt : Date.now() } satisfies PeerHeartbeat), HEARTBEAT_MS);
// A page that closes normally gets this event. A page that the browser stops does not.
addEventListener("pagehide", () => channel.postMessage({ id, source : "pagehide", sentAt : Date.now() } satisfies PeerHeartbeat));

const workerSource = `
const channel = new BroadcastChannel("lag-e7");
setInterval(() => channel.postMessage({ id : ${JSON.stringify(id)}, source : "worker", sentAt : Date.now() }), ${HEARTBEAT_MS});`;
new Worker(URL.createObjectURL(new Blob([workerSource], { type : "text/javascript" })));

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

void navigator.locks.request(`lag-e7:${id}`, () => {
    window.peerReady = true;
    // The page holds the lock until it closes
    return new Promise<never>(() => {});
});
