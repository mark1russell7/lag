/**
 * A hang that was in progress, as the worker last saw it. Times are absolute
 * (Unix milliseconds).
 */
export type HangRecord = {
    /** The ID of the page instance whose main thread hung. */
    pageId : string;
    /** The time of the last acknowledgement before the hang. */
    startedAt : number;
    /** The last time that the worker saw the hang continue. */
    lastSeenAt : number;
    /** The context of the page at the time of the hang, for example `lag.page_view.id`. */
    attributes : Readonly<Record<string, string>>;
};

/**
 * Persistent storage for hangs in progress.
 *
 * A page can close or crash during a hang. Then nobody reports the end of
 * the hang, and the longest hangs are the ones that a monitor loses. The
 * worker writes a record when a hang starts, writes it again while the hang
 * continues, and removes it when the hang ends. The next page of the same
 * origin finds the records that nobody updates, reports them as abandoned
 * hangs, and removes them.
 *
 * IndexedDB gives this storage in pages and in workers
 * (`createIndexedDbHangJournal`).
 */
export type HangJournal = {
    put(record : HangRecord) : Promise<void>;
    remove(pageId : string) : Promise<void>;
    list() : Promise<HangRecord[]>;
};

/** The worker writes a record of a continuing hang again at this interval. */
export const HANG_JOURNAL_WRITE_INTERVAL_MS = 1_000;

/**
 * A record that nobody updated for this long belongs to a page that closed
 * during the hang. The value is much longer than the write interval, so
 * that a short stop of a live worker does not look like an abandoned hang.
 */
export const HANG_JOURNAL_STALE_MS = 30_000;

/** A journal in memory, for tests and for environments without IndexedDB. */
export function createMemoryHangJournal() : HangJournal {
    const records = new Map<string, HangRecord>();
    return {
        put : (record) => {
            records.set(record.pageId, { ...record, attributes : { ...record.attributes } });
            return Promise.resolve();
        },
        remove : (pageId) => {
            records.delete(pageId);
            return Promise.resolve();
        },
        list : () => Promise.resolve([...records.values()]),
    };
}

/** The records of pages that closed during a hang: records that nobody updated for `staleMs`. */
export function findAbandonedHangs(
    records : readonly HangRecord[],
    now : number,
    ownPageId : string,
    staleMs : number = HANG_JOURNAL_STALE_MS,
) : HangRecord[] {
    return records.filter(record => record.pageId !== ownPageId && now - record.lastSeenAt >= staleMs);
}
