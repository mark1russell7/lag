import { describe, it, expect } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createMemoryHangJournal, findAbandonedHangs, HANG_JOURNAL_STALE_MS, type HangJournal, type HangRecord } from "./hang-journal.js";
import { createIndexedDbHangJournal } from "./browser/indexeddb-journal.js";

const record = (pageId : string, lastSeenAt : number) : HangRecord => ({
    pageId,
    startedAt : lastSeenAt - 8_000,
    lastSeenAt,
    attributes : { "lag.page_view.id" : `view-of-${pageId}` },
});

function describeJournal(name : string, create : () => HangJournal) {
    describe(name, () => {
        it("takes a record that was seen exactly at the limit", async () => {
            const journal = create();
            await journal.put(record("a", 5_000));

            expect(await journal.take("a", 5_000)).toEqual(record("a", 5_000));
        });

        it("keeps one record for each page, and the newest write wins", async () => {
            const journal = create();
            await journal.put(record("a", 1_000));
            await journal.put(record("b", 2_000));
            await journal.put(record("a", 3_000));

            const records = (await journal.list()).sort((x, y) => x.pageId.localeCompare(y.pageId));
            expect(records).toEqual([record("a", 3_000), record("b", 2_000)]);
        });

        it("removes a record", async () => {
            const journal = create();
            await journal.put(record("a", 1_000));
            await journal.remove("a");
            await journal.remove("unknown");
            expect(await journal.list()).toEqual([]);
        });

        it("takes a stale record one time, and does not take a record that somebody updated after the limit", async () => {
            const journal = create();
            await journal.put(record("stale", 1_000));
            await journal.put(record("live", 9_000));

            expect(await journal.take("stale", 5_000)).toEqual(record("stale", 1_000));
            expect(await journal.take("stale", 5_000)).toBeUndefined();
            expect(await journal.take("live", 5_000)).toBeUndefined();
            expect(await journal.take("unknown", 5_000)).toBeUndefined();
            expect((await journal.list()).map(r => r.pageId)).toEqual(["live"]);
        });

        it("keeps a copy of the attributes, not the object of the caller", async () => {
            const journal = create();
            const attributes : Record<string, string> = { "lag.page_view.id" : "first" };
            await journal.put({ pageId : "a", startedAt : 0, lastSeenAt : 1, attributes });
            attributes["lag.page_view.id"] = "changed";
            expect((await journal.list())[0]!.attributes).toEqual({ "lag.page_view.id" : "first" });
        });
    });
}

describeJournal("createMemoryHangJournal", createMemoryHangJournal);
describeJournal("createIndexedDbHangJournal", () => createIndexedDbHangJournal(new IDBFactory()));

describe("createIndexedDbHangJournal", () => {
    it("shares the records between two journals of the same database, as a page and its worker do", async () => {
        const factory = new IDBFactory();
        await createIndexedDbHangJournal(factory).put(record("worker-page", 5_000));
        expect(await createIndexedDbHangJournal(factory).list()).toEqual([record("worker-page", 5_000)]);
    });

    it("gives a record to only one of two journals that take it at the same time, as two pages do", async () => {
        const factory = new IDBFactory();
        await createIndexedDbHangJournal(factory).put(record("closed-page", 1_000));
        const results = await Promise.all([
            createIndexedDbHangJournal(factory).take("closed-page", 5_000),
            createIndexedDbHangJournal(factory).take("closed-page", 5_000),
        ]);
        expect(results.filter(r => r !== undefined)).toEqual([record("closed-page", 1_000)]);
    });

    it("ignores records that are not hang records", async () => {
        const factory = new IDBFactory();
        const journal = createIndexedDbHangJournal(factory);
        await journal.put(record("a", 1));
        await journal.put({ pageId : "b" } as unknown as HangRecord);
        expect((await journal.list()).map(r => r.pageId)).toEqual(["a"]);
    });

    it("ignores and does not take the records whose fields have the wrong type", async () => {
        const factory = new IDBFactory();
        const journal = createIndexedDbHangJournal(factory);
        await journal.put(record("a", 1));
        await new Promise<void>((resolve, reject) => {
            const request = factory.open("lag-hang-journal", 1);
            request.onsuccess = () => {
                const db = request.result;
                const transaction = db.transaction("hangs", "readwrite");
                const store = transaction.objectStore("hangs");
                store.put({ pageId : "b", startedAt : "1", lastSeenAt : 2, attributes : {} });
                store.put({ pageId : "c", startedAt : 1, lastSeenAt : "2", attributes : {} });
                store.put({ pageId : "d", startedAt : 1, lastSeenAt : 2, attributes : null });
                store.put({ pageId : "e", startedAt : 1, lastSeenAt : 2, attributes : "x" });
                transaction.oncomplete = () => { db.close(); resolve(); };
                transaction.onerror = () => reject(transaction.error);
            };
            request.onerror = () => reject(request.error);
        });

        expect((await journal.list()).map(r => r.pageId)).toEqual(["a"]);
        expect(await journal.take("b", 10)).toBeUndefined();
    });

    it("rejects when the database cannot open, and tries again at the next operation", async () => {
        let attempts = 0;
        const failing = {
            open() {
                attempts++;
                const request = { result : undefined, error : new Error("blocked"), onsuccess : null, onerror : null as (() => void) | null, onupgradeneeded : null };
                queueMicrotask(() => request.onerror?.());
                return request;
            },
        };
        const journal = createIndexedDbHangJournal(failing as never);
        await expect(journal.list()).rejects.toThrow("blocked");
        await expect(journal.list()).rejects.toThrow("blocked");
        expect(attempts).toBe(2);
    });
});

describe("findAbandonedHangs", () => {
    it("finds the records that nobody updated for the stale time, except the own page", () => {
        const now = 100_000;
        const records = [
            record("closed", now - HANG_JOURNAL_STALE_MS),
            record("alive", now - 1_000),
            record("own", now - 60_000),
        ];
        expect(findAbandonedHangs(records, now, "own").map(r => r.pageId)).toEqual(["closed"]);
    });
});
