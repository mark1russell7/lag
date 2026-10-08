import { expect } from "vitest";
import { recordMeasurement } from "./commands.js";
import { probeServiceWorker, probeSharedWorker, probeWorkerFetch, probeWorkerIndexedDb, waitedForBlock } from "./worker-io.js";

/**
 * A worker must write and send during a hang of the main thread: the hang
 * report and the hang journal depend on it. These tests measure the
 * behavior of each engine. In Chromium and Firefox, the input and output of
 * a worker continue during the block. WebKit and Safari complete them on the
 * main thread, after the block: for a dedicated, a shared and a service
 * worker. A change of the behavior of an engine makes these
 * tests fail, so that the documentation changes too.
 */
const BLOCK_MS = 2_000;
const webKit = /AppleWebKit/.test(navigator.userAgent) && !/Chrome\//.test(navigator.userAgent);
const engine = webKit ? "webkit" : /Firefox\//.test(navigator.userAgent) ? "firefox" : "chromium";

describe("the input and output of a worker during a main-thread block", () => {
    it("an IndexedDB write of a worker completes during the block, except in WebKit", async () => {
        const times = await probeWorkerIndexedDb(BLOCK_MS);
        await recordMeasurement("worker-io/indexeddb_write_done_after_block_start", "ms", [times.doneMs], { engine });
        expect(waitedForBlock(times), JSON.stringify(times)).toBe(webKit);
    }, 20_000);

    it("a fetch with keepalive of a worker completes during the block, except in WebKit", async () => {
        const times = await probeWorkerFetch(BLOCK_MS);
        await recordMeasurement("worker-io/fetch_done_after_block_start", "ms", [times.doneMs], { engine });
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
