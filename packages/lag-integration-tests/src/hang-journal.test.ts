import { expect } from "vitest";
import { createBrowserDeps, createIndexedDbHangJournal, createNoopMeter, setupAllMonitors } from "@lag/core";
import { createLagWorker } from "@lag/worker";
import { blockMainThread, wait } from "./harness.js";

/**
 * A page that does not survive a hang: the worker writes the hang to
 * IndexedDB while the main thread is blocked. Here the worker stops before
 * the main thread runs again, as when the page closes during the hang.
 */
describe("hang journal in a browser", () => {
    it("keeps the record of a hang that did not end", async () => {
        const journal = createIndexedDbHangJournal(indexedDB);
        for (const record of await journal.list()) await journal.remove(record.pageId);

        const worker = createLagWorker();
        const handles = setupAllMonitors(createBrowserDeps(window, {
            logger : { log : () => {} },
            meter : createNoopMeter(),
            worker,
            workerHeartbeatIntervalMs : 100,
        }));
        const viewId = handles.vitals?.getView().id;
        try {
            await wait(500);
            blockMainThread(6_500);
            // The page "closes" before it handles the messages of the worker
            worker.terminate();
        } finally {
            handles.stop();
        }

        const records = await journal.list();
        expect(records).toHaveLength(1);
        const [record] = records;
        expect(record!.pageId).toMatch(/^[0-9a-f]{32}$/);
        expect(record!.lastSeenAt - record!.startedAt).toBeGreaterThanOrEqual(5_000);
        expect(record!.attributes).toEqual(viewId ? { "lag.page_view.id" : viewId } : {});

        await journal.remove(record!.pageId);
    }, 30_000);
});
