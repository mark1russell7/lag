import type { HangJournal, HangRecord } from "../hang-journal.js";

/*
 * Duck types for the parts of IndexedDB that the journal uses. The event
 * handlers take `never`, so that the real IndexedDB objects (whose handlers
 * take specific event types) fit.
 */
type IdbRequestLike<T> = {
    readonly result : T;
    readonly error? : unknown;
    onsuccess : ((event : never) => unknown) | null;
    onerror : ((event : never) => unknown) | null;
};

type IdbObjectStoreLike = {
    put(value : unknown) : IdbRequestLike<unknown>;
    get(key : string) : IdbRequestLike<unknown>;
    delete(key : string) : IdbRequestLike<unknown>;
    getAll() : IdbRequestLike<unknown[]>;
};

type IdbTransactionLike = {
    readonly error? : unknown;
    objectStore(name : string) : IdbObjectStoreLike;
    oncomplete : ((event : never) => unknown) | null;
    onabort : ((event : never) => unknown) | null;
};

type IdbDatabaseLike = {
    readonly objectStoreNames : { contains(name : string) : boolean };
    createObjectStore(name : string, options : { keyPath : string }) : unknown;
    transaction(name : string, mode : "readonly" | "readwrite") : IdbTransactionLike;
};

type IdbOpenRequestLike = IdbRequestLike<IdbDatabaseLike> & {
    onupgradeneeded : ((event : never) => unknown) | null;
};

/** `indexedDB`, in a page or in a worker. */
export type IdbFactoryLike = {
    open(name : string, version? : number) : IdbOpenRequestLike;
};

const STORE = "hangs";
const VERSION = 1;

function promised<T>(request : IdbRequestLike<T>) : Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function isHangRecord(value : unknown) : value is HangRecord {
    const record = value as Partial<HangRecord> | null;
    return typeof record?.pageId === "string"
        && typeof record.startedAt === "number"
        && typeof record.lastSeenAt === "number"
        && typeof record.attributes === "object" && record.attributes !== null;
}

/**
 * A hang journal in IndexedDB. Pages and workers of one origin share it.
 * The database opens at the first operation. An operation fails (the promise
 * rejects) when the browser does not permit IndexedDB, for example in some
 * private windows.
 */
export function createIndexedDbHangJournal(factory : IdbFactoryLike, name : string = "lag-hang-journal") : HangJournal {
    let database : Promise<IdbDatabaseLike> | undefined;
    const open = () : Promise<IdbDatabaseLike> => {
        database ??= new Promise<IdbDatabaseLike>((resolve, reject) => {
            const request = factory.open(name, VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath : "pageId" });
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        }).catch((error : unknown) => {
            // The next operation tries again
            database = undefined;
            throw error;
        });
        return database;
    };
    const store = async (mode : "readonly" | "readwrite") : Promise<IdbObjectStoreLike> =>
        (await open()).transaction(STORE, mode).objectStore(STORE);

    return {
        async put(record) {
            await promised((await store("readwrite")).put({ ...record, attributes : { ...record.attributes } }));
        },
        async remove(pageId) {
            await promised((await store("readwrite")).delete(pageId));
        },
        async list() {
            const values = await promised((await store("readonly")).getAll());
            return values.filter(isHangRecord);
        },
        async take(pageId, latestSeenAt) {
            const transaction = (await open()).transaction(STORE, "readwrite");
            return new Promise<HangRecord | undefined>((resolve, reject) => {
                // The get and the delete are in one read-write transaction. The browser runs such
                // transactions of one store one after the other, also across pages.
                const objectStore = transaction.objectStore(STORE);
                let taken : HangRecord | undefined;
                const request = objectStore.get(pageId);
                request.onsuccess = () => {
                    const value = request.result;
                    if (!isHangRecord(value) || value.lastSeenAt > latestSeenAt) return;
                    taken = value;
                    objectStore.delete(pageId);
                };
                transaction.oncomplete = () => resolve(taken);
                transaction.onabort = () => reject(transaction.error);
            });
        },
    };
}
