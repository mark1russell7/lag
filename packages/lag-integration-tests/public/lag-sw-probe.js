/*
 * A service worker for the browser test "the writes and fetches of a service
 * worker during a main-thread block" (src/worker-io.test.ts). It writes to
 * IndexedDB and sends a fetch each 100 ms, on its own timer, and it gives the
 * completion times when the page asks for them.
 */
const completed = [];
let started = false;

function work() {
    const open = indexedDB.open("lag-worker-io-service", 1);
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

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("message", (event) => {
    const port = event.ports[0];
    if (event.data === "start" && !started) {
        started = true;
        setInterval(work, 100);
    }
    if (event.data === "report" && port) port.postMessage(completed.slice());
});
