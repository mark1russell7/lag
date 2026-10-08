/**
 * Probes of the input and output of workers while the main thread is
 * blocked. WebKit completes the IndexedDB requests and the fetches of a
 * worker on the main thread. Then a worker cannot write or send anything
 * during a hang, and the hang journal cannot keep a hang that the page does
 * not survive.
 */
import { blockMainThread, wait } from "./harness.js";

/** The times of one probe, in milliseconds after the start of the block. */
export type WorkerIoTimes = {
    /** The worker started the operation. */
    startMs : number;
    /** The operation completed. */
    doneMs : number;
    /** The block ended. */
    blockMs : number;
};

const INDEXED_DB_PROBE = `
self.onmessage = (event) => {
    const start = performance.timeOrigin + performance.now();
    const open = indexedDB.open(event.data, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("probe", { keyPath : "key" });
    open.onsuccess = () => {
        const transaction = open.result.transaction("probe", "readwrite");
        transaction.objectStore("probe").put({ key : String(start) });
        transaction.oncomplete = () => self.postMessage({ start, done : performance.timeOrigin + performance.now() });
    };
};`;

const FETCH_PROBE = `
self.onmessage = (event) => {
    const start = performance.timeOrigin + performance.now();
    const done = () => self.postMessage({ start, done : performance.timeOrigin + performance.now() });
    fetch(event.data, { method : "POST", body : "probe", keepalive : true }).then(done, done);
};`;

/** The shared worker writes and sends on its own timer, because a message from the page can also wait. */
const SHARED_PROBE = `
const completed = [];
let started = false;
function work() {
    const open = indexedDB.open("lag-worker-io-shared", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("probe", { keyPath : "key" });
    open.onsuccess = () => {
        const transaction = open.result.transaction("probe", "readwrite");
        transaction.objectStore("probe").put({ key : String(performance.now()) });
        transaction.oncomplete = () => {
            const done = () => completed.push(performance.timeOrigin + performance.now());
            fetch(self.location.origin + "/__lag_worker_io_probe", { method : "POST", body : "probe", keepalive : true }).then(done, done);
        };
    };
}
self.onconnect = (event) => {
    const port = event.ports[0];
    port.onmessage = (message) => {
        if (message.data === "start" && !started) {
            started = true;
            setInterval(work, 100);
        }
        if (message.data === "report") port.postMessage(completed.slice());
    };
};`;

function scriptUrl(source : string) : string {
    return URL.createObjectURL(new Blob([source], { type : "text/javascript" }));
}

const absoluteNow = () : number => performance.timeOrigin + performance.now();

async function probe(source : string, message : string, blockMs : number) : Promise<WorkerIoTimes> {
    const worker = new Worker(scriptUrl(source));
    try {
        const result = new Promise<{ start : number; done : number }>((resolve) => {
            worker.onmessage = (event) => resolve(event.data as { start : number; done : number });
        });
        await wait(200);
        worker.postMessage(message);
        const blockStart = absoluteNow();
        blockMainThread(blockMs);
        const blockEnd = absoluteNow();
        const { start, done } = await result;
        return { startMs : start - blockStart, doneMs : done - blockStart, blockMs : blockEnd - blockStart };
    } finally {
        worker.terminate();
    }
}

/** This function measures when an IndexedDB write of a dedicated worker completes, during a block of `blockMs`. */
export function probeWorkerIndexedDb(blockMs : number) : Promise<WorkerIoTimes> {
    return probe(INDEXED_DB_PROBE, `lag-worker-io-${Math.random()}`, blockMs);
}

/** This function measures when a fetch with `keepalive` of a dedicated worker completes, during a block of `blockMs`. */
export function probeWorkerFetch(blockMs : number) : Promise<WorkerIoTimes> {
    return probe(FETCH_PROBE, new URL(`/__lag_worker_io_probe?${Math.random()}`, location.href).href, blockMs);
}

/**
 * This function counts the writes and fetches of a shared worker that
 * complete during a block of `blockMs`. It gives `undefined` when the
 * browser has no `SharedWorker`.
 */
export async function probeSharedWorker(blockMs : number) : Promise<{ completed : number; duringBlock : number } | undefined> {
    if (typeof SharedWorker === "undefined") return undefined;
    const worker = new SharedWorker(scriptUrl(SHARED_PROBE));
    let resolveReport : (times : number[]) => void = () => {};
    worker.port.onmessage = (event) => resolveReport(event.data as number[]);
    worker.port.start();
    worker.port.postMessage("start");
    await wait(600);
    const blockStart = absoluteNow();
    blockMainThread(blockMs);
    const blockEnd = absoluteNow();
    await wait(300);
    const completed = await new Promise<number[]>((resolve) => {
        resolveReport = resolve;
        worker.port.postMessage("report");
    });
    worker.port.close();
    // A margin of 100 ms at the two ends of the block
    const duringBlock = completed.filter(time => time > blockStart + 100 && time < blockEnd - 100).length;
    return { completed : completed.length, duringBlock };
}

/** This function waits until the service worker of `registration` is active. */
function activeWorker(registration : ServiceWorkerRegistration) : Promise<ServiceWorker> {
    return new Promise((resolve, reject) => {
        const worker = registration.active ?? registration.waiting ?? registration.installing;
        if (!worker) {
            reject(new Error("The registration has no service worker."));
            return;
        }
        if (worker.state === "activated") {
            resolve(worker);
            return;
        }
        worker.addEventListener("statechange", () => {
            if (worker.state === "activated") resolve(worker);
            if (worker.state === "redundant") reject(new Error("The service worker became redundant."));
        });
    });
}

/**
 * This function counts the writes and fetches of a service worker
 * (`public/lag-sw-probe.js`) that complete during a block of `blockMs`. A
 * service worker operates outside the page. Thus it could keep a record of a
 * hang where a dedicated worker cannot. The function gives `undefined` when
 * the page cannot have a service worker.
 */
export async function probeServiceWorker(blockMs : number) : Promise<{ completed : number; duringBlock : number } | undefined> {
    if (!("serviceWorker" in navigator)) return undefined;
    const registration = await navigator.serviceWorker.register("/lag-sw-probe.js", { scope : "/lag-sw-probe/" });
    try {
        const worker = await activeWorker(registration);
        const report = () : Promise<number[]> => new Promise((resolve) => {
            const channel = new MessageChannel();
            channel.port1.onmessage = (event) => resolve(event.data as number[]);
            worker.postMessage("report", [channel.port2]);
        });
        worker.postMessage("start");
        await wait(600);
        const blockStart = absoluteNow();
        blockMainThread(blockMs);
        const blockEnd = absoluteNow();
        await wait(300);
        const completed = await report();
        const duringBlock = completed.filter(time => time > blockStart + 100 && time < blockEnd - 100).length;
        return { completed : completed.length, duringBlock };
    } finally {
        await registration.unregister();
    }
}

/** True when the IndexedDB requests of a worker complete only after a block of the main thread, as in WebKit. */
export async function workerIndexedDbWaitsForMainThread() : Promise<boolean> {
    const times = await probeWorkerIndexedDb(500);
    return times.doneMs >= times.blockMs;
}
