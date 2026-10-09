import type { AllMonitorDeps } from "../setup-all-monitors.js";
import type { EventSink } from "../events.js";
import type { SpanSink } from "../spans.js";
import type { Meter } from "../meter.js";
import type { Logger, PerformanceLike } from "../types.js";
import type { PerformanceEntryLike, PerformanceObserverInit } from "../perf-types.js";
import { getPageLifecycle, type LifecycleDocument, type LifecycleWindow } from "../LifecycleStateMachine.js";
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
import { createStorageHangReportMarks, type StorageLike } from "../hang-journal.js";
import type { CrashReportContextLike } from "../dep-groups.js";
import type { AbortControllerConstructor, BroadcastChannelConstructor, LockManagerLike } from "../PeerHangWatch.js";

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
    readonly localStorage? : unknown;
    readonly crashReport? : unknown;
    readonly BroadcastChannel? : unknown;
    readonly AbortController? : unknown;
    readonly navigator? : unknown;
};

export type BrowserDepsOptions = {
    logger : Logger;
    meter : Meter;
    events? : EventSink;
    /** The span sink, for example `createOtelSpanSink()`. Without it, the monitors make no spans. */
    spans? : SpanSink;
    /** The worker in which the `@mark1russell7/lag/worker` handler operates. Without it, the worker monitors stay off. */
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
     * bundled worker writes the journal. The peer hang watch takes the record
     * of a hung page from the journal, also in a page without a worker. The
     * watch also marks its reports in `localStorage`, thus the journal reader
     * does not count them again.
     */
    hangJournal? : boolean;
    /** When true (the default), the page-view ID goes into the crash-report context of the browser (Chrome 145 and later). */
    crashReportContext? : boolean;
    /**
     * When true (the default), the open pages of the origin watch each other
     * for hangs, through `BroadcastChannel` and the Web Locks API. A visible
     * page sends one heartbeat each second and holds one Web Lock. In WebKit
     * and Safari, this is the only way to keep a hang that the page does not
     * survive. It needs a second open page of the origin.
     */
    peerHangWatch? : boolean;
    /** More attributes for the hang reports of the worker, for example the session ID. Refer to `PageDeps.pageContext`. */
    pageContext? : () => Readonly<Record<string, string>>;
    /**
     * When true (the default), the monitors use the lifecycle tracker that the
     * page shares (`getPageLifecycle()` of `page-lifecycle-tracker`). Then an
     * exporter can subscribe to the same tracker in the `export` phase. It
     * sends the last telemetry after the monitors recorded the end of the
     * page. The setting applies only when `globals` is the global object.
     */
    sharedLifecycle? : boolean;
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

/** `localStorage`, if the page can use it. The browser can refuse it, for example in a sandboxed frame: then the read throws. */
function localStorageOf(globals : BrowserGlobals) : StorageLike | undefined {
    try {
        const storage = globals.localStorage as Partial<StorageLike> | null | undefined;
        return typeof storage?.getItem === "function" && typeof storage.setItem === "function" ? storage as StorageLike : undefined;
    } catch {
        return undefined;
    }
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
    const BroadcastChannel = constructorOf<BroadcastChannelConstructor>(globals.BroadcastChannel);
    const AbortController = constructorOf<AbortControllerConstructor>(globals.AbortController);
    const locks = (globals.navigator as { locks? : Partial<LockManagerLike> } | undefined)?.locks;
    const peerDeps = options.peerHangWatch !== false && BroadcastChannel && typeof locks?.request === "function"
        ? { BroadcastChannel, locks : { request : locks.request.bind(locks) }, ...(AbortController ? { AbortController } : {}) }
        : undefined;
    // The worker monitor reads the journal. The peer hang watch takes the record of a hung page from it, also without a worker.
    const indexedDB = globals.indexedDB as IdbFactoryLike | undefined;
    const journalOn = options.hangJournal !== false && (options.worker !== undefined || peerDeps !== undefined);
    const hangJournal = journalOn && typeof indexedDB?.open === "function" ? createIndexedDbHangJournal(indexedDB) : undefined;
    const storage = journalOn ? localStorageOf(globals) : undefined;
    // The shared tracker belongs to the global object: a test with other globals gets no shared tracker
    const lifecycleTracker = options.sharedLifecycle !== false && (globals as unknown) === globalThis
        ? getPageLifecycle({ document : globals.document, window : globals, clock : { now }, logger : options.logger })
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
        ...(lifecycleTracker ? { lifecycleTracker } : {}),
        performance,
        page : createPageSource(globals.document, performance),
        ...(options.softNavigations !== undefined ? { softNavigations : options.softNavigations } : {}),
        ...(options.pageContext ? { pageContext : options.pageContext } : {}),
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
        ...(options.spans ? { spans : options.spans } : {}),
        ...(options.worker ? { worker : options.worker } : {}),
        ...(options.workerHeartbeatIntervalMs !== undefined ? { workerHeartbeatIntervalMs : options.workerHeartbeatIntervalMs } : {}),
        ...(options.workerHangReport ? { workerHangReport : options.workerHangReport } : {}),
        ...(hangJournal ? { hangJournal } : {}),
        ...(storage ? { hangReportMarks : createStorageHangReportMarks(storage) } : {}),
        ...(crashReportContext ? { crashReport : crashReportContext } : {}),
        ...peerDeps,
    };
}
