import type {
    AllMonitorDeps,
    Attributes,
    EventSink,
    HangReportTarget,
    LegacyMemory,
    Logger,
    MeasureMemoryResult,
    MemorySource,
    Meter,
    PressureObserverInit,
    ReportingObserverInit,
    WorkerLike,
} from "@lag/core";

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

export type TeeMeter = {
    meter : Meter;
    /** Every value recorded so far by the named histogram or counter. */
    values(name : string) : number[];
    max(name : string) : number;
    /** Total values recorded across all instruments. */
    totalRecords() : number;
};

/**
 * Wraps a real OTel meter so tests can also inspect what was recorded:
 * values still flow to the exporter.
 */
export function createTeeMeter(inner : Meter) : TeeMeter {
    const recorded = new Map<string, number[]>();
    const sink = (name : string) : number[] => {
        const values : number[] = [];
        recorded.set(name, values);
        return values;
    };

    const meter : Meter = {
        createHistogram<A extends Attributes>(name : string, options : { unit : string }) {
            const histogram = inner.createHistogram<A>(name, options);
            const values = sink(name);
            return {
                record(value : number, attributes? : A) {
                    values.push(value);
                    histogram.record(value, attributes);
                },
            };
        },
        createCounter<A extends Attributes>(name : string, options : { unit : string }) {
            const counter = inner.createCounter<A>(name, options);
            const values = sink(name);
            return {
                add(value : number, attributes? : A) {
                    values.push(value);
                    counter.add(value, attributes);
                },
            };
        },
    };

    return {
        meter,
        values : (name) => recorded.get(name) ?? [],
        max : (name) => Math.max(0, ...(recorded.get(name) ?? [])),
        totalRecords : () => [...recorded.values()].reduce((n, values) => n + values.length, 0),
    };
}

export function createConsoleLogger(levels : readonly string[] = ["trace", "debug", "info", "warn", "error"]) : Logger {
    return {
        log(level, message, args) {
            if (levels.includes(level)) console.log(`[${level}] ${message}`, args);
        },
    };
}

type BrowserPerformance = Performance & {
    memory? : LegacyMemory;
    measureUserAgentSpecificMemory? : () => Promise<MeasureMemoryResult>;
};

/** setupAllMonitors deps backed by the real browser APIs. */
export function createBrowserDeps(options : {
    logger : Logger;
    meter : Meter;
    events? : EventSink;
    worker? : WorkerLike;
    workerHeartbeatIntervalMs? : number;
    workerHangReport? : HangReportTarget;
    memoryIntervalMs? : number;
}) : AllMonitorDeps {
    const perf = window.performance as BrowserPerformance;
    const memorySource : MemorySource = {};
    if (perf.memory) memorySource.readLegacy = () => perf.memory;
    if (perf.measureUserAgentSpecificMemory) memorySource.measureModern = () => perf.measureUserAgentSpecificMemory!();
    const PressureObserver = (window as unknown as { PressureObserver? : PressureObserverInit }).PressureObserver;
    const ReportingObserver = (window as unknown as { ReportingObserver? : ReportingObserverInit }).ReportingObserver;

    return {
        logger : options.logger,
        meter : options.meter,
        clock : { now : () => performance.now() },
        wallClock : { now : () => Date.now() },
        setTimeoutFn : (fn, ms) => window.setTimeout(fn, ms),
        clearTimeoutFn : (id) => window.clearTimeout(id),
        setIntervalFn : (fn, ms) => window.setInterval(fn, ms),
        clearIntervalFn : (id) => window.clearInterval(id),
        document,
        window,
        performance : window.performance,
        PerformanceObserver : window.PerformanceObserver,
        requestAnimationFrame : (cb) => window.requestAnimationFrame(cb),
        cancelAnimationFrame : (id) => window.cancelAnimationFrame(id),
        requestIdleCallback : (cb, opts) => window.requestIdleCallback(cb, opts),
        cancelIdleCallback : (id) => window.cancelIdleCallback(id),
        MessageChannel : window.MessageChannel,
        queueMicrotask : (cb) => window.queueMicrotask(cb),
        memorySource,
        FinalizationRegistry : window.FinalizationRegistry,
        ...(options.events ? { events : options.events } : {}),
        ...(ReportingObserver ? { ReportingObserver } : {}),
        ...(options.workerHangReport ? { workerHangReport : options.workerHangReport } : {}),
        ...(options.memoryIntervalMs !== undefined ? { memoryIntervalMs : options.memoryIntervalMs } : {}),
        ...(options.worker ? { worker : options.worker } : {}),
        ...(options.workerHeartbeatIntervalMs !== undefined ? { workerHeartbeatIntervalMs : options.workerHeartbeatIntervalMs } : {}),
        ...(PressureObserver ? { PressureObserver, pressureSources : ["cpu" as const] } : {}),
    };
}
