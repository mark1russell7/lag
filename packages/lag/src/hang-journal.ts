/**
 * A hang that was in progress, as the worker last saw it. The times are
 * wall-clock times (`Date.now()`, Unix milliseconds). Other pages compare
 * them with their own time, and the wall clock is the only clock that all
 * pages share. The monotonic clock of a page stops while the device sleeps
 * (except on Windows), thus it can be behind the wall clock by hours.
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
    /**
     * This method removes the record of `pageId` and gives it. It does this
     * only for a stale record: a record whose `lastSeenAt` is not after
     * `latestSeenAt`. The operation is atomic. When two pages try to take the
     * same record at the same time, only one page gets it.
     */
    take(pageId : string, latestSeenAt : number) : Promise<HangRecord | undefined>;
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
        take : (pageId, latestSeenAt) => {
            const record = records.get(pageId);
            if (!record || record.lastSeenAt > latestSeenAt) return Promise.resolve(undefined);
            records.delete(pageId);
            return Promise.resolve(record);
        },
    };
}

/**
 * The marks of the hangs that the peer hang watch reported, but whose
 * journal record it could not remove. A page that reports its own hang at
 * its close cannot wait for IndexedDB, and its worker can stop before it
 * removes the record. The journal reader of a later page takes the record of
 * a marked page, but it does not count the hang again.
 */
export type HangReportMarks = {
    /** This method marks the hang of the page `pageId` as reported, at the wall-clock time `reportedAt`. */
    add(pageId : string, reportedAt : number) : void;
    /** This method removes the mark of the page `pageId`. It gives true if the mark was there. */
    take(pageId : string) : boolean;
    /** This method removes each mark from before `before`, except the marks of the pages in `keep`. */
    prune(before : number, keep : ReadonlySet<string>) : void;
};

/** The part of `localStorage` that the marks use. */
export type StorageLike = {
    readonly length : number;
    key(index : number) : string | null;
    getItem(key : string) : string | null;
    setItem(key : string, value : string) : void;
    removeItem(key : string) : void;
};

/**
 * The key of a mark is this prefix and the page ID. The value is the
 * wall-clock time of the report. Pages with different versions of the
 * library share the keys.
 */
export const HANG_REPORT_MARK_PREFIX = "lag-hang-reported:";

/**
 * This function keeps the marks in a synchronous storage of the origin
 * (`localStorage`). A page at its close can write them, because the write is
 * synchronous. An operation that the storage refuses (for example when it
 * is full or blocked) does nothing.
 */
export function createStorageHangReportMarks(storage : StorageLike) : HangReportMarks {
    const attempt = <T>(operation : () => T, fallback : T) : T => {
        try {
            return operation();
        } catch {
            return fallback;
        }
    };
    return {
        add : (pageId, reportedAt) => attempt(() => storage.setItem(HANG_REPORT_MARK_PREFIX + pageId, String(reportedAt)), undefined),
        take : (pageId) => attempt(() => {
            const key = HANG_REPORT_MARK_PREFIX + pageId;
            if (storage.getItem(key) === null) return false;
            storage.removeItem(key);
            return true;
        }, false),
        prune : (before, keep) => attempt(() => {
            const stale : string[] = [];
            for (let index = 0; index < storage.length; index++) {
                const key = storage.key(index);
                if (!key?.startsWith(HANG_REPORT_MARK_PREFIX) || keep.has(key.slice(HANG_REPORT_MARK_PREFIX.length))) continue;
                // A mark with a value that is not a time also goes
                const reportedAt = Number(storage.getItem(key));
                if (!(reportedAt >= before)) stale.push(key);
            }
            for (const key of stale) storage.removeItem(key);
        }, undefined),
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
