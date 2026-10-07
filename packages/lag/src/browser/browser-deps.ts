import type { AllMonitorDeps } from "../setup-all-monitors.js";
import type { EventSink } from "../events.js";
import type { Meter } from "../meter.js";
import type { Logger, PerformanceLike } from "../types.js";
import type { PerformanceEntryLike, PerformanceObserverInit } from "../perf-types.js";
import type { LifecycleDocument, LifecycleWindow } from "../LifecycleStateMachine.js";
import type { RequestAnimationFrameFn, CancelAnimationFrameFn } from "../FrameTimingMonitor.js";
import type { RequestIdleCallbackFn, CancelIdleCallbackFn } from "../IdleAvailabilityMonitor.js";
import type { MessageChannelConstructor, QueueMicrotaskFn } from "../SchedulingFairnessMonitor.js";
import type { LegacyMemory, MeasureMemoryResult, MemorySource } from "../MemoryMonitor.js";
import type { PressureObserverInit, PressureSource } from "../ComputePressureMonitor.js";
import type { FinalizationRegistryConstructor } from "../GCSignalDetector.js";
import type { ReportingObserverInit } from "../BrowserReportMonitor.js";
import type { WorkerLike } from "../WorkerLagMonitor.js";
import type { HangReportTarget } from "../worker-protocol.js";
import { createPageSource, type PageDocument } from "./page-source.js";
import { createIndexedDbHangJournal, type IdbFactoryLike } from "./indexeddb-journal.js";
import type { CrashReportContextLike } from "../dep-groups.js";

/**
 * The browser globals that the adapter reads. In a page, `window` has them.
 * The optional APIs have the type `unknown`: the adapter examines each one
 * before it uses it.
 */
export type BrowserGlobals = LifecycleWindow & {
    document : LifecycleDocument & PageDocument;
    performance : PerformanceLike & {
        getEntriesByType?(type : string) : readonly PerformanceEntryLike[];
        readonly memory? : unknown;
        readonly measureUserAgentSpecificMemory? : unknown;
    };
    setTimeout(handler : () => void, timeout : number) : number;
    clearTimeout(handle : number) : void;
    setInterval(handler : () => void, timeout : number) : number;
    clearInterval(handle : number) : void;
    readonly PerformanceObserver? : unknown;
    readonly requestAnimationFrame? : unknown;
    readonly cancelAnimationFrame? : unknown;
    readonly requestIdleCallback? : unknown;
    readonly cancelIdleCallback? : unknown;
    readonly MessageChannel? : unknown;
    readonly queueMicrotask? : unknown;
    readonly FinalizationRegistry? : unknown;
    readonly ReportingObserver? : unknown;
    readonly PressureObserver? : unknown;
    readonly SharedArrayBuffer? : unknown;
    readonly crossOriginIsolated? : unknown;
    readonly indexedDB? : unknown;
    readonly crashReport? : unknown;
};

export type BrowserDepsOptions = {
    logger : Logger;
    meter : Meter;
    events? : EventSink;
    /** The worker in which the `@lag/worker` handler operates. Without it, the worker monitors stay off. */
    worker? : WorkerLike;
    workerHeartbeatIntervalMs? : number;
    workerHangReport? : HangReportTarget;
    memoryIntervalMs? : number;
    /** The Compute Pressure sources to observe. The default is `["cpu"]`. */
    pressureSources? : PressureSource[];
    /** When true, each soft navigation starts a new page view. The default is false. */
    softNavigations? : boolean;
    /**
     * When true (the default), a cross-origin-isolated page uses shared memory
     * for the liveness watcher. The watcher also needs `worker`.
     */
    sharedMemory? : boolean;
    /**
     * When true (the default), the worker monitor reads the hang journal in
     * IndexedDB and reports the hangs that earlier pages did not survive. The
     * bundled worker writes the journal.
     */
    hangJournal? : boolean;
    /** When true (the default), the page-view ID goes into the crash-report context of the browser (Chrome 145 and later). */
    crashReportContext? : boolean;
};

/** The method `name` of `target`, bound to `target`, or `undefined` if `target` has no such method. */
function method<F>(target : object, name : string) : F | undefined {
    const value : unknown = (target as Record<string, unknown>)[name];
    return typeof value === "function" ? value.bind(target) as F : undefined;
}

/** `value` if it is a function (for example a constructor), or `undefined` if not. */
function constructorOf<C>(value : unknown) : C | undefined {
    return typeof value === "function" ? value as C : undefined;
}

function memorySourceOf(performance : BrowserGlobals["performance"]) : MemorySource | undefined {
    const source : MemorySource = {};
    if (typeof performance.memory === "object" && performance.memory !== null) {
        source.readLegacy = () => performance.memory as LegacyMemory;
    }
    const measure = method<() => Promise<MeasureMemoryResult>>(performance, "measureUserAgentSpecificMemory");
    if (measure) source.measureModern = measure;
    return source.readLegacy || source.measureModern ? source : undefined;
}

/**
 * The browser adapter: it gets the dependencies of `setupAllMonitors` from
 * the browser globals. It examines each optional API. A missing API stops
 * only the monitors that use it. For example, Safari has no
 * `requestIdleCallback`, thus the idle monitor stays off there.
 *
 * Each function from the browser is bound to its object, because browsers
 * do not permit some functions (for example `requestAnimationFrame`) without
 * their `this` value.
 */
export function createBrowserDeps(globals : BrowserGlobals, options : BrowserDepsOptions) : AllMonitorDeps {
    const performance = globals.performance;
    const now = method<() => number>(performance, "now")!;
    const memorySource = memorySourceOf(performance);
    const PerformanceObserver = constructorOf<PerformanceObserverInit>(globals.PerformanceObserver);
    const requestAnimationFrame = method<RequestAnimationFrameFn>(globals, "requestAnimationFrame");
    const cancelAnimationFrame = method<CancelAnimationFrameFn>(globals, "cancelAnimationFrame");
    const requestIdleCallback = method<RequestIdleCallbackFn>(globals, "requestIdleCallback");
    const cancelIdleCallback = method<CancelIdleCallbackFn>(globals, "cancelIdleCallback");
    const MessageChannel = constructorOf<MessageChannelConstructor>(globals.MessageChannel);
    const queueMicrotask = method<QueueMicrotaskFn>(globals, "queueMicrotask");
    const FinalizationRegistry = constructorOf<FinalizationRegistryConstructor>(globals.FinalizationRegistry);
    const ReportingObserver = constructorOf<ReportingObserverInit>(globals.ReportingObserver);
    const PressureObserver = constructorOf<PressureObserverInit>(globals.PressureObserver);
    const SharedArrayBuffer = globals.crossOriginIsolated === true && options.sharedMemory !== false
        ? constructorOf<new (byteLength : number) => SharedArrayBuffer>(globals.SharedArrayBuffer)
        : undefined;
    const indexedDB = globals.indexedDB as IdbFactoryLike | undefined;
    const hangJournal = options.hangJournal !== false && options.worker && typeof indexedDB?.open === "function"
        ? createIndexedDbHangJournal(indexedDB)
        : undefined;
    const crashReport = globals.crashReport as CrashReportContextLike | undefined;
    const crashReportContext = options.crashReportContext !== false && typeof crashReport?.set === "function" ? crashReport : undefined;

    return {
        logger : options.logger,
        meter : options.meter,
        clock : { now },
        wallClock : { now : () => Date.now() },
        setTimeoutFn : (handler, timeout) => globals.setTimeout(handler, timeout),
        clearTimeoutFn : (handle) => globals.clearTimeout(handle),
        setIntervalFn : (handler, timeout) => globals.setInterval(handler, timeout),
        clearIntervalFn : (handle) => globals.clearInterval(handle),
        document : globals.document,
        window : globals,
        performance,
        page : createPageSource(globals.document, performance),
        ...(options.softNavigations !== undefined ? { softNavigations : options.softNavigations } : {}),
        ...(PerformanceObserver ? { PerformanceObserver } : {}),
        ...(requestAnimationFrame && cancelAnimationFrame ? { requestAnimationFrame, cancelAnimationFrame } : {}),
        ...(requestIdleCallback && cancelIdleCallback ? { requestIdleCallback, cancelIdleCallback } : {}),
        ...(MessageChannel && queueMicrotask ? { MessageChannel, queueMicrotask } : {}),
        ...(memorySource ? { memorySource } : {}),
        ...(options.memoryIntervalMs !== undefined ? { memoryIntervalMs : options.memoryIntervalMs } : {}),
        ...(FinalizationRegistry ? { FinalizationRegistry } : {}),
        ...(ReportingObserver ? { ReportingObserver } : {}),
        ...(PressureObserver ? { PressureObserver, pressureSources : options.pressureSources ?? ["cpu"] } : {}),
        ...(SharedArrayBuffer ? { SharedArrayBuffer } : {}),
        ...(options.events ? { events : options.events } : {}),
        ...(options.worker ? { worker : options.worker } : {}),
        ...(options.workerHeartbeatIntervalMs !== undefined ? { workerHeartbeatIntervalMs : options.workerHeartbeatIntervalMs } : {}),
        ...(options.workerHangReport ? { workerHangReport : options.workerHangReport } : {}),
        ...(hangJournal ? { hangJournal } : {}),
        ...(crashReportContext ? { crashReport : crashReportContext } : {}),
    };
}
