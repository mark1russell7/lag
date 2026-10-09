/**
 * Probes of the input and output of workers while the main thread is
 * blocked (experiments E4 and E6). WebKit completes the input and output of a
 * worker on the main thread. Then a worker cannot write or send anything
 * during a hang, and the hang journal cannot keep a hang that the page does
 * not survive.
 */
import { blockMainThread, wait } from "./harness.js";
import { startProbeSocketServer, stopProbeSocketServer } from "./commands.js";

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

/** A URL of the Vitest server for the requests of the probes. The probes use only the end of each request, not its response. */
const probeUrl = () : string => new URL(`/__lag_worker_io_probe?${Math.random()}`, location.href).href;

const PING = "lag-probe-ping";
const PONG = "lag-probe-pong";

/**
 * The probe worker answers a ping before the probe starts. Thus a late start
 * of the worker cannot look like a wait. A message from the worker is not
 * sufficient. In Chromium, a message to a new worker can wait in the page
 * until the page operates again.
 */
const PING_LISTENER = `self.addEventListener("message", (event) => {
    if (event.data !== ${JSON.stringify(PING)}) return;
    event.stopImmediatePropagation();
    self.postMessage(${JSON.stringify(PONG)});
});
`;

async function probe(source : string, message : string, blockMs : number) : Promise<WorkerIoTimes> {
    // The ping listener comes first, thus it starts before the onmessage handler of the probe
    const worker = new Worker(scriptUrl(PING_LISTENER + source));
    try {
        let markReady = () : void => {};
        const ready = new Promise<void>((resolve) => { markReady = resolve; });
        const result = new Promise<{ start : number; done : number }>((resolve) => {
            worker.onmessage = (event) => {
                if (event.data === PONG) markReady();
                else resolve(event.data as { start : number; done : number });
            };
        });
        worker.postMessage(PING);
        await ready;
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
    return probe(FETCH_PROBE, probeUrl(), blockMs);
}


/**
 * The output operations of a dedicated worker that experiment E6 measures,
 * in addition to those of E4:
 * - `opfs-sync-access`: a write and a flush through a
 *   `FileSystemSyncAccessHandle`, in the origin private file system (OPFS)
 * - `opfs-writable`: a write through a `FileSystemWritableFileStream`, in the OPFS
 * - `opfs-lookup`: `getDirectory()` and `getFileHandle()`, in the OPFS
 * - `cache-put`: `Cache.put()` of the Cache API
 * - `xhr` and `sync-xhr`: an `XMLHttpRequest`, asynchronous and synchronous.
 */
export type WorkerOutput = "opfs-sync-access" | "opfs-writable" | "opfs-lookup" | "cache-put" | "xhr" | "sync-xhr";

/**
 * The worker prepares each operation in a first message, for example it opens
 * the file. A second message starts the operation. Thus the probe measures
 * only the operation. The worker gives `unavailable` when it does not have
 * the API.
 */
const OUTPUT_PROBE = `
let fileHandle, accessHandle;
const now = () => performance.timeOrigin + performance.now();
async function prepare(kind) {
    if (kind.startsWith("opfs-")) {
        if (typeof navigator.storage?.getDirectory !== "function") return "The worker has no navigator.storage.getDirectory().";
        const root = await navigator.storage.getDirectory();
        fileHandle = await root.getFileHandle("lag-worker-io-" + kind, { create : true });
        if (kind === "opfs-sync-access") {
            if (typeof fileHandle.createSyncAccessHandle !== "function") return "The worker has no createSyncAccessHandle().";
            accessHandle = await fileHandle.createSyncAccessHandle();
        }
        if (kind === "opfs-writable" && typeof fileHandle.createWritable !== "function") return "The worker has no createWritable().";
    }
    if (kind === "cache-put" && typeof caches === "undefined") return "The worker has no caches.";
    return undefined;
}
function send(url, async) {
    return new Promise((resolve) => {
        const request = new XMLHttpRequest();
        request.open("POST", url, async);
        request.onloadend = resolve;
        try { request.send("probe"); } catch { resolve(); }
        if (!async) resolve();
    });
}
async function operate(kind, url, start) {
    const text = String(start);
    if (kind === "opfs-sync-access") {
        accessHandle.write(new TextEncoder().encode(text), { at : 0 });
        accessHandle.flush();
        accessHandle.close();
    }
    if (kind === "opfs-writable") {
        const writable = await fileHandle.createWritable();
        await writable.write(text);
        await writable.close();
    }
    if (kind === "opfs-lookup") await (await navigator.storage.getDirectory()).getFileHandle("lag-worker-io-lookup", { create : true });
    if (kind === "cache-put") await (await caches.open("lag-worker-io")).put(new Request(url), new Response(text));
    if (kind === "xhr" || kind === "sync-xhr") await send(url, kind === "xhr");
}
self.onmessage = async (event) => {
    const { kind, url, go } = event.data;
    try {
        if (!go) {
            self.postMessage({ unavailable : await prepare(kind) });
            return;
        }
        const start = now();
        await operate(kind, url, start);
        self.postMessage({ start, done : now() });
    } catch (error) {
        self.postMessage({ error : String(error) });
    }
};`;

/** The worker opens a WebSocket in the first message, and sends one message through it in the second message. */
const WEBSOCKET_PROBE = `
let socket;
self.onmessage = (event) => {
    const { url, go } = event.data;
    if (!go) {
        socket = new WebSocket(url);
        socket.onopen = () => self.postMessage({ ready : true });
        socket.onerror = () => self.postMessage({ error : "The WebSocket did not open." });
        return;
    }
    const start = performance.timeOrigin + performance.now();
    socket.send(String(start));
    self.postMessage({ start });
};`;

type ProbeReply = { unavailable? : string; error? : string; ready? : boolean; start? : number; done? : number };

/** This function sends `message` to `worker` and gives the next reply. */
function ask(worker : Worker, message : unknown) : Promise<ProbeReply> {
    const reply = new Promise<ProbeReply>((resolve) => {
        worker.onmessage = (event) => resolve(event.data as ProbeReply);
    });
    worker.postMessage(message);
    return reply;
}

/**
 * This function measures when an output operation of a dedicated worker
 * completes, during a block of `blockMs`. It gives `undefined` when the
 * worker does not have the API. For example, the WebKit build of Playwright
 * for Windows has no `navigator.storage`.
 */
export async function probeWorkerOutput(kind : WorkerOutput, blockMs : number) : Promise<WorkerIoTimes | undefined> {
    const worker = new Worker(scriptUrl(OUTPUT_PROBE));
    try {
        const url = probeUrl();
        const prepared = await ask(worker, { kind, url, go : false });
        if (prepared.error !== undefined) throw new Error(`${kind}: ${prepared.error}`);
        if (prepared.unavailable !== undefined) return undefined;
        await wait(200);
        const result = ask(worker, { kind, url, go : true });
        const blockStart = absoluteNow();
        blockMainThread(blockMs);
        const blockEnd = absoluteNow();
        const { start, done, error } = await result;
        if (error !== undefined) throw new Error(`${kind}: ${error}`);
        return { startMs : start! - blockStart, doneMs : done! - blockStart, blockMs : blockEnd - blockStart };
    } finally {
        worker.terminate();
    }
}

/**
 * This function measures when a WebSocket message of a dedicated worker
 * arrives at a server, during a block of `blockMs`. The server is a command
 * in Node (`commands/probe-socket.ts`). It records the arrival with the wall
 * clock of the machine. The time of the page also comes from the wall clock
 * (`performance.timeOrigin`), thus the two times can differ by some
 * milliseconds.
 */
export async function probeWorkerWebSocket(blockMs : number) : Promise<WorkerIoTimes> {
    const port = await startProbeSocketServer();
    const worker = new Worker(scriptUrl(WEBSOCKET_PROBE));
    try {
        const opened = await ask(worker, { url : `ws://127.0.0.1:${port}/`, go : false });
        if (opened.error !== undefined) throw new Error(opened.error);
        await wait(200);
        const sent = ask(worker, { go : true });
        const blockStart = absoluteNow();
        blockMainThread(blockMs);
        const blockEnd = absoluteNow();
        const { start } = await sent;
        // The message can arrive after the block
        await wait(300);
        const [arrival] = await stopProbeSocketServer();
        if (arrival === undefined) throw new Error("The server got no message.");
        return { startMs : start! - blockStart, doneMs : arrival - blockStart, blockMs : blockEnd - blockStart };
    } finally {
        worker.terminate();
        await stopProbeSocketServer();
    }
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

/** The worker and the page read different clocks. Thus a completion this short time before the end of the block also counts as a wait. */
const CLOCK_MARGIN_MS = 25;

/**
 * True when an operation of a worker waited for the end of a block of the
 * main thread. Then it completed at the end of the block or later. An operation
 * that waits needs the main thread, thus it cannot complete during the
 * block. A slow operation that completes during the block did not wait. On a
 * busy CI runner, an IndexedDB write of Firefox completed after 1141 ms of a
 * block of 2000 ms.
 */
export function waitedForBlock(times : WorkerIoTimes) : boolean {
    return times.doneMs >= times.blockMs - CLOCK_MARGIN_MS;
}
