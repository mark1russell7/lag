import { createWorkerHandler, type HangEvent } from "@lag/core/lag-worker.js";
import type { HangOptions } from "@lag/core/worker-protocol.js";
import { encodeOtlpLogs } from "@lag/core/otlp-json.js";
import { formatEventLine } from "@lag/core/event-line.js";
import { createIndexedDbHangJournal } from "@lag/core/browser/indexeddb-journal.js";

// Read timeOrigin one time: Safari calculates it again from the wall clock at each read
const origin = performance.timeOrigin;
const clock = { now : () => origin + performance.now() };

/**
 * This function sends a hang report as an OTLP/HTTP JSON log record. The
 * main thread is blocked while a hang starts. Thus, only the worker can send
 * this report.
 */
function reportHang(event : HangEvent, options : HangOptions) : void {
    const target = options.report;
    if (!target) return;
    const attributes = { ...event.attributes, phase : event.phase, duration_ms : event.durationMs };
    const body = encodeOtlpLogs(target.resource ?? {}, "@lag/worker", [{
        // OTLP log times are wall-clock times, as the OpenTelemetry SDK writes them
        timeMs : Date.now(),
        eventName : "lag.main_thread.hang",
        severityText : "WARN",
        severityNumber : 13,
        // The same line as the events of the main thread (the name and the attributes)
        body : formatEventLine("lag.main_thread.hang", attributes),
        attributes,
    }]);
    // sendBeacon does not exist in workers; keepalive lets the request finish if the page closes
    fetch(target.url, { method : "POST", headers : { "Content-Type" : "application/json" }, body, keepalive : true })
        .catch(() => { /* the report is best effort */ });
}

const handler = createWorkerHandler({
    postMessage : (message) => self.postMessage(message),
    setTimeoutFn : (fn, ms) => self.setTimeout(fn, ms),
    clearTimeoutFn : (id) => self.clearTimeout(id),
    setIntervalFn : (fn, ms) => self.setInterval(fn, ms),
    clearIntervalFn : (id) => self.clearInterval(id),
    clock,
    reportHang,
    // A record of each hang in progress, for the next page if this page does not survive the hang
    ...(typeof indexedDB === "undefined" ? {} : { journal : createIndexedDbHangJournal(indexedDB) }),
});

self.addEventListener("message", (event : MessageEvent) => {
    handler.handleMessage(event.data);
});
