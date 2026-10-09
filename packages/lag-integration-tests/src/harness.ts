import { queryMimirValue } from "./commands.js";
import {
    createBrowserDeps as createCoreBrowserDeps,
    type AllMonitorDeps,
    type Attributes,
    type BrowserDepsOptions,
    type BrowserGlobals,
    type Logger,
    type Meter,
} from "@mark1russell7/lag";
import type { LagWorker } from "@mark1russell7/lag/worker";

/** Block the main thread synchronously for `ms` milliseconds. */
export function blockMainThread(ms : number) : void {
    const start = performance.now();
    while (performance.now() - start < ms) {
        // busy wait
    }
}

/** Wait for real time to pass. */
export function wait(ms : number) : Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/** This function gives a promise that resolves after `count` animation frames. */
export function nextFrames(count = 1) : Promise<void> {
    return new Promise(resolve => {
        const step = (left : number) : void => {
            if (left === 0) resolve();
            else requestAnimationFrame(() => step(left - 1));
        };
        step(count);
    });
}

/** This function polls `condition` every 50 ms until it is true or `timeoutMs` passes. The function gives the last result. */
export async function waitUntil(condition : () => boolean, timeoutMs = 5_000) : Promise<boolean> {
    const deadline = performance.now() + timeoutMs;
    while (!condition()) {
        if (performance.now() > deadline) return false;
        await wait(50);
    }
    return true;
}

export const median = (values : readonly number[]) : number => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
};

export const sum = (values : readonly number[]) : number => values.reduce((total, value) => total + value, 0);

/** One value that an instrument recorded. */
export type RecordedValue = {
    value : number;
    attributes : Attributes | undefined;
    /** `performance.now()` at the time of the record. */
    time : number;
};

export type TeeMeter = {
    meter : Meter;
    /** Every value recorded so far by the named histogram or counter. */
    values(name : string) : number[];
    /** Every value with its attributes and time. */
    records(name : string) : RecordedValue[];
    max(name : string) : number;
    /** The sum of the values of a counter, for the records that have all of `attributes`. */
    total(name : string, attributes? : Attributes) : number;
    /** Total values recorded across all instruments. */
    totalRecords() : number;
};

function matches(recorded : Attributes | undefined, wanted : Attributes | undefined) : boolean {
    if (!wanted) return true;
    return Object.entries(wanted).every(([key, value]) => recorded?.[key] === value);
}

/**
 * This function wraps a real OTel meter, so that the tests can examine the
 * recorded values. The values also go to the exporter.
 */
export function createTeeMeter(inner : Meter) : TeeMeter {
    const recorded = new Map<string, RecordedValue[]>();
    const sink = (name : string) : RecordedValue[] => {
        const records : RecordedValue[] = recorded.get(name) ?? [];
        recorded.set(name, records);
        return records;
    };

    const meter : Meter = {
        createHistogram<A extends Attributes>(name : string, options : { unit : string }) {
            const histogram = inner.createHistogram<A>(name, options);
            const records = sink(name);
            return {
                record(value : number, attributes? : A) {
                    records.push({ value, attributes, time : performance.now() });
                    histogram.record(value, attributes);
                },
            };
        },
        createCounter<A extends Attributes>(name : string, options : { unit : string }) {
            const counter = inner.createCounter<A>(name, options);
            const records = sink(name);
            return {
                add(value : number, attributes? : A) {
                    records.push({ value, attributes, time : performance.now() });
                    counter.add(value, attributes);
                },
            };
        },
    };

    const recordsOf = (name : string) : RecordedValue[] => recorded.get(name) ?? [];
    return {
        meter,
        values : (name) => recordsOf(name).map(r => r.value),
        records : recordsOf,
        max : (name) => Math.max(0, ...recordsOf(name).map(r => r.value)),
        total : (name, attributes) => sum(recordsOf(name).filter(r => matches(r.attributes, attributes)).map(r => r.value)),
        totalRecords : () => [...recorded.values()].reduce((n, records) => n + records.length, 0),
    };
}

/** The count, sum and maximum of each instrument, in constant memory (for long runs). */
export type SummaryMeter = {
    meter : Meter;
    count(name : string) : number;
    max(name : string) : number;
    totalRecords() : number;
};

export function createSummaryMeter() : SummaryMeter {
    const summaries = new Map<string, { count : number; sum : number; max : number }>();
    const summaryOf = (name : string) => {
        let summary = summaries.get(name);
        if (!summary) {
            summary = { count : 0, sum : 0, max : 0 };
            summaries.set(name, summary);
        }
        return summary;
    };
    const add = (name : string, value : number) : void => {
        const summary = summaryOf(name);
        summary.count++;
        summary.sum += value;
        summary.max = Math.max(summary.max, value);
    };
    return {
        meter : {
            createHistogram : (name) => ({ record : (value) => add(name, value) }),
            createCounter : (name) => ({ add : (value) => add(name, value) }),
        },
        count : (name) => summaries.get(name)?.count ?? 0,
        max : (name) => summaries.get(name)?.max ?? 0,
        totalRecords : () => [...summaries.values()].reduce((n, summary) => n + summary.count, 0),
    };
}

/**
 * The number of `metric` samples (the count of a histogram) that Mimir has
 * for `service`, or 0 if Mimir has none or does not answer. The query
 * accepts a native histogram and a classic histogram (a `_count` series).
 * Mimir translates the `service.name` attribute of the OTLP resource into the
 * `job` label. A `service_name` label exists only if Mimir promotes the
 * attribute. The query accepts both, and the `_milliseconds` unit suffix that
 * Mimir adds when it is configured to.
 */
export async function queryMimirCount(metric : string, service : string) : Promise<number> {
    // A native histogram (an exponential histogram of OTLP) is one series: histogram_count() gives its count.
    // A classic histogram has a _count series.
    const native = `__name__=~"${metric}(_milliseconds)?"`;
    const classic = `__name__=~"${metric}(_milliseconds)?_count"`;
    const query = [
        `sum(histogram_count({${native}, service_name="${service}"}))`,
        `sum(histogram_count({${native}, job=~"(.+/)?${service}"}))`,
        `sum({${classic}, service_name="${service}"})`,
        `sum({${classic}, job=~"(.+/)?${service}"})`,
    ].join(" or ");
    // Node sends the query: Mimir sends no CORS headers, thus the page cannot read the answer
    return queryMimirValue(query);
}

/** This function polls `queryMimirCount` until the count is above 0 or `timeoutMs` passes. Alloy batches for up to 1 s, and then Mimir ingests. */
export async function waitForMimirCount(metric : string, service : string, timeoutMs : number) : Promise<number> {
    const deadline = performance.now() + timeoutMs;
    for (;;) {
        const count = await queryMimirCount(metric, service);
        if (count > 0 || performance.now() > deadline) return count;
        await wait(3_000);
    }
}

export function createConsoleLogger(levels : readonly string[] = ["trace", "debug", "info", "warn", "error"]) : Logger {
    return {
        log(level, message, args) {
            if (levels.includes(level)) console.log(`[${level}] ${message}`, args);
        },
    };
}

/** A logger that keeps the messages at or above `warn`, for assertions. */
export function createRecordingLogger() : Logger & { messages : Array<{ level : string; message : string }> } {
    const messages : Array<{ level : string; message : string }> = [];
    return {
        messages,
        log(level, message) {
            if (level === "warn" || level === "error") messages.push({ level, message });
        },
    };
}

/**
 * setupAllMonitors deps backed by the real browser APIs, through the core
 * browser adapter. Thus the tests also examine the adapter in each browser.
 */
export function createBrowserDeps(options : BrowserDepsOptions, globals : BrowserGlobals = window) : AllMonitorDeps {
    return createCoreBrowserDeps(globals, options);
}

export type CallbackCounts = {
    timeouts : number;
    intervals : number;
    animationFrames : number;
    idleCallbacks : number;
    messages : number;
};

/**
 * Browser globals for `createBrowserDeps` that count the callbacks of the
 * monitors and keep the pending timers. The monitors use only the injected
 * functions, so the counts are exactly their callbacks.
 */
export type TimerAccounting = {
    globals : BrowserGlobals;
    /** The callbacks that started after `createTimerAccounting()` or after the last `resetCounts()`. */
    counts() : CallbackCounts;
    /** The timers, intervals, frame requests and idle requests that are scheduled, did not fire and were not cancelled. */
    pending() : Omit<CallbackCounts, "messages">;
    resetCounts() : void;
};

export function createTimerAccounting(win : Window & typeof globalThis = window) : TimerAccounting {
    const fired : CallbackCounts = { timeouts : 0, intervals : 0, animationFrames : 0, idleCallbacks : 0, messages : 0 };
    const timeouts = new Set<number>();
    const intervals = new Set<number>();
    const frames = new Set<number>();
    const idles = new Set<number>();

    // WebKit has no requestIdleCallback, although the DOM types declare it
    const idleApi = win as { requestIdleCallback? : Window["requestIdleCallback"]; cancelIdleCallback? : Window["cancelIdleCallback"] };
    const requestIdle = idleApi.requestIdleCallback?.bind(win);
    const cancelIdle = idleApi.cancelIdleCallback?.bind(win);

    /** The `port1` of each channel counts its messages. The monitors listen on `port1`, through `createMessageTaskQueue`. */
    function CountingMessageChannel() : { port1 : unknown; port2 : MessagePort } {
        const channel = new win.MessageChannel();
        const port = channel.port1;
        const port1 = {
            postMessage : (data : unknown) => port.postMessage(data),
            start : () => port.start(),
            close : () => port.close(),
            get onmessage() {
                return port.onmessage;
            },
            set onmessage(handler : ((event : MessageEvent) => void) | null) {
                port.onmessage = handler
                    ? (event : MessageEvent) => {
                        fired.messages++;
                        handler(event);
                    }
                    : null;
            },
        };
        return { port1, port2 : channel.port2 };
    }

    const globals : BrowserGlobals = {
        document : win.document,
        performance : win.performance,
        addEventListener : (type, listener, options) => win.addEventListener(type, listener as EventListener, options),
        removeEventListener : (type, listener, options) => win.removeEventListener(type, listener as EventListener, options),
        setTimeout(handler, timeout) {
            const id : number = win.setTimeout(() => {
                timeouts.delete(id);
                fired.timeouts++;
                handler();
            }, timeout);
            timeouts.add(id);
            return id;
        },
        clearTimeout(id) {
            timeouts.delete(id);
            win.clearTimeout(id);
        },
        setInterval(handler, timeout) {
            const id = win.setInterval(() => {
                fired.intervals++;
                handler();
            }, timeout);
            intervals.add(id);
            return id;
        },
        clearInterval(id) {
            intervals.delete(id);
            win.clearInterval(id);
        },
        requestAnimationFrame(callback : FrameRequestCallback) {
            const id : number = win.requestAnimationFrame((time) => {
                frames.delete(id);
                fired.animationFrames++;
                callback(time);
            });
            frames.add(id);
            return id;
        },
        cancelAnimationFrame(id : number) {
            frames.delete(id);
            win.cancelAnimationFrame(id);
        },
        ...(requestIdle && cancelIdle
            ? {
                requestIdleCallback(callback : IdleRequestCallback, options? : IdleRequestOptions) {
                    const id : number = requestIdle((deadline) => {
                        idles.delete(id);
                        fired.idleCallbacks++;
                        callback(deadline);
                    }, options);
                    idles.add(id);
                    return id;
                },
                cancelIdleCallback(id : number) {
                    idles.delete(id);
                    cancelIdle(id);
                },
            }
            : {}),
        PerformanceObserver : win.PerformanceObserver,
        MessageChannel : CountingMessageChannel,
        queueMicrotask : (callback : () => void) => win.queueMicrotask(callback),
        FinalizationRegistry : win.FinalizationRegistry,
        ReportingObserver : (win as { ReportingObserver? : unknown }).ReportingObserver,
        PressureObserver : (win as { PressureObserver? : unknown }).PressureObserver,
        SharedArrayBuffer : (win as { SharedArrayBuffer? : unknown }).SharedArrayBuffer,
        crossOriginIsolated : win.crossOriginIsolated,
    };

    return {
        globals,
        counts : () => ({ ...fired }),
        pending : () => ({ timeouts : timeouts.size, intervals : intervals.size, animationFrames : frames.size, idleCallbacks : idles.size }),
        resetCounts() {
            fired.timeouts = 0;
            fired.intervals = 0;
            fired.animationFrames = 0;
            fired.idleCallbacks = 0;
            fired.messages = 0;
        },
    };
}

/** This function counts the messages that the main thread receives from the worker (heartbeats and replies). */
export function countWorkerMessages(worker : LagWorker) : { worker : LagWorker; count() : number; reset() : void } {
    let received = 0;
    const counted : LagWorker = {
        postMessage : (message) => worker.postMessage(message),
        addEventListener : (type, handler) => worker.addEventListener(type, handler),
        removeEventListener : (type, handler) => worker.removeEventListener(type, handler),
        terminate : () => worker.terminate(),
    };
    worker.addEventListener("message", () => { received++; });
    return { worker : counted, count : () => received, reset : () => { received = 0; } };
}
