import { expect } from "vitest";
import { recordMeasurement } from "./commands.js";
import { probeServiceWorker, probeSharedWorker, probeWorkerFetch, probeWorkerIndexedDb, probeWorkerOutput, probeWorkerWebSocket, waitedForBlock, type WorkerOutput } from "./worker-io.js";

/**
 * A worker must write and send during a hang of the main thread: the hang
 * report and the hang journal depend on it. These tests measure the
 * behavior of each engine (experiments E4 and E6). In Chromium and Firefox,
 * the IndexedDB requests and the fetches of a worker continue during the
 * block. WebKit and Safari complete them on the main thread, after the
 * block: for a dedicated, a shared and a service worker. A change of the
 * behavior of an engine makes these tests fail, so that the documentation
 * changes too.
 */
const BLOCK_MS = 2_000;
const webKit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome\//.test(navigator.userAgent);
const engine = webKit ? "webkit" : /Firefox\//.test(navigator.userAgent) ? "firefox" : "chromium";
type Engine = typeof engine;

/**
 * The engines in which each output operation of a dedicated worker waits
 * for the end of the block (experiment E6). The engine "webkit" includes
 * Safari. Firefox operates a WebSocket and an `XMLHttpRequest` of a worker
 * through the main thread, but not the storage APIs.
 */
const WAITS_FOR_MAIN_THREAD : Record<WorkerOutput | "websocket", readonly Engine[]> = {
    "opfs-sync-access" : ["webkit"],
    "opfs-writable" : ["webkit"],
    "opfs-lookup" : ["webkit"],
    "cache-put" : ["webkit"],
    "xhr" : ["webkit", "firefox"],
    "sync-xhr" : ["webkit", "firefox"],
    "websocket" : ["webkit", "firefox"],
};

const OUTPUTS : readonly WorkerOutput[] = ["opfs-sync-access", "opfs-writable", "opfs-lookup", "cache-put", "xhr", "sync-xhr"];

const measurementName = (operation : string) : string => `worker-io/${operation.replaceAll("-", "_")}_done_after_block_start`;

describe("the input and output of a worker during a main-thread block", () => {
    it("an IndexedDB write of a worker completes during the block, except in WebKit", async () => {
        const times = await probeWorkerIndexedDb(BLOCK_MS);
        await recordMeasurement("worker-io/indexeddb_write_done_after_block_start", "ms", [times.doneMs], { engine });
        // The worker started the write early in the block: thus a late completion is a wait, not a late start
        expect(times.startMs, JSON.stringify(times)).toBeLessThan(times.blockMs / 2);
        expect(waitedForBlock(times), JSON.stringify(times)).toBe(webKit);
    }, 20_000);

    it("a fetch with keepalive of a worker completes during the block, except in WebKit", async () => {
        const times = await probeWorkerFetch(BLOCK_MS);
        await recordMeasurement("worker-io/fetch_done_after_block_start", "ms", [times.doneMs], { engine });
        expect(times.startMs, JSON.stringify(times)).toBeLessThan(times.blockMs / 2);
        expect(waitedForBlock(times), JSON.stringify(times)).toBe(webKit);
    }, 20_000);

    it("the writes and fetches of a service worker complete during the block, except in WebKit", async (ctx) => {
        const result = await probeServiceWorker(BLOCK_MS);
        ctx.skip(result === undefined, "This page cannot have a service worker.");
        console.log(`Service worker (${engine}): ${result!.duringBlock} of ${result!.completed} operations completed during the block`);
        await recordMeasurement("worker-io/service_worker_operations_during_block", "{operation}", [result!.duringBlock], { engine });
        expect(result!.completed).toBeGreaterThan(0);
        // Also a service worker cannot write or send during the block in WebKit and in Safari 26
        if (webKit) expect(result!.duringBlock).toBe(0);
        else expect(result!.duringBlock).toBeGreaterThan(5);
    }, 20_000);

    it("the writes and fetches of a shared worker complete during the block, except in WebKit", async (ctx) => {
        const result = await probeSharedWorker(BLOCK_MS);
        ctx.skip(result === undefined, "This browser has no SharedWorker.");
        await recordMeasurement("worker-io/shared_worker_operations_during_block", "{operation}", [result!.duringBlock], { engine });
        expect(result!.completed).toBeGreaterThan(0);
        if (webKit) expect(result!.duringBlock).toBe(0);
        else expect(result!.duringBlock).toBeGreaterThan(5);
    }, 20_000);
});

describe("the output of a dedicated worker during a main-thread block (experiment E6)", () => {
    for (const kind of OUTPUTS) {
        const waits = WAITS_FOR_MAIN_THREAD[kind].includes(engine);
        it(`${kind}: the operation ${waits ? "waits for the end of" : "completes during"} the block`, async (ctx) => {
            const times = await probeWorkerOutput(kind, BLOCK_MS);
            ctx.skip(times === undefined, `The worker of this browser has no API for ${kind}.`);
            console.log(`E6 ${kind} (${engine}): ${JSON.stringify(times)}`);
            await recordMeasurement(measurementName(kind), "ms", [times!.doneMs], { engine });
            expect(waitedForBlock(times!), JSON.stringify(times)).toBe(waits);
        }, 20_000);
    }

    const socketWaits = WAITS_FOR_MAIN_THREAD.websocket.includes(engine);
    it(`websocket: the message ${socketWaits ? "arrives after" : "arrives during"} the block`, async () => {
        const times = await probeWorkerWebSocket(BLOCK_MS);
        console.log(`E6 websocket (${engine}): ${JSON.stringify(times)}`);
        await recordMeasurement(measurementName("websocket-arrival"), "ms", [times.doneMs], { engine });
        expect(waitedForBlock(times), JSON.stringify(times)).toBe(socketWaits);
    }, 20_000);
});
