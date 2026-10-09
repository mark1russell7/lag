/**
 * The dependency groups, one for each capability.
 *
 * Each group describes one capability that a monitor can use. An
 * instrumented factory combines the groups that it uses with intersection
 * types, for example `FrameDeps & CoreDeps`. It does not take one flat
 * object of approximately 25 fields. Thus, the dependencies of each factory
 * are clear. Also, the code obeys the interface segregation principle (ISP).
 * A consumer that does not use the frame timing monitor does not know about
 * `requestAnimationFrame`.
 */

import type {
    Clock,
    Logger,
    PerformanceLike,
    WallClock,
    SetTimeoutFn,
    ClearTimeoutFn,
    SetIntervalFn,
    ClearIntervalFn,
} from "./types.js";
import type { Meter } from "./meter.js";
import type { EventSink } from "./events.js";
import type { PerformanceObserverInit } from "./perf-types.js";
import type {
    RequestAnimationFrameFn,
    CancelAnimationFrameFn,
} from "./FrameTimingMonitor.js";
import type {
    RequestIdleCallbackFn,
    CancelIdleCallbackFn,
} from "./IdleAvailabilityMonitor.js";
import type {
    MessageChannelConstructor,
    QueueMicrotaskFn,
} from "./SchedulingFairnessMonitor.js";
import type { MemorySource } from "./MemoryMonitor.js";
import type {
    PressureObserverInit,
    PressureSource,
} from "./ComputePressureMonitor.js";
import type { FinalizationRegistryConstructor } from "./GCSignalDetector.js";
import type { WorkerLike } from "./WorkerLagMonitor.js";
import type { HangReportTarget } from "./worker-protocol.js";
import type { HangJournal } from "./hang-journal.js";
import type { AbortControllerConstructor, BroadcastChannelConstructor, LockManagerLike } from "./PeerHangWatch.js";
import type { ReportingObserverInit } from "./BrowserReportMonitor.js";
import type { PageSource } from "./vitals/types.js";
import type { AbsoluteClock } from "./absolute-clock.js";
import type {
    LifecycleDocument,
    LifecycleWindow,
} from "./LifecycleStateMachine.js";

/** The core dependencies of each instrumented monitor. */
export type CoreDeps = {
    logger : Logger;
    clock : Clock;
    meter : Meter;
};

/** The functions that schedule and cancel timers. */
export type TimerDeps = {
    setTimeoutFn : SetTimeoutFn;
    clearTimeoutFn : ClearTimeoutFn;
    setIntervalFn : SetIntervalFn;
    clearIntervalFn : ClearIntervalFn;
};

/** The `document` and the `window` of the browser, to follow the page lifecycle. */
export type LifecycleDeps = {
    document : LifecycleDocument;
    window : LifecycleWindow;
};

/** `PerformanceObserver`, for LoAF, Event Timing, layout shifts, paint entries and LCP. */
export type ObserverDeps = {
    PerformanceObserver : PerformanceObserverInit;
};

/** The animation frame functions, for the frame timing monitor. */
export type FrameDeps = {
    requestAnimationFrame : RequestAnimationFrameFn;
    cancelAnimationFrame : CancelAnimationFrameFn;
};

/** The idle callback functions, for the idle availability monitor. */
export type IdleDeps = {
    requestIdleCallback : RequestIdleCallbackFn;
    cancelIdleCallback : CancelIdleCallbackFn;
};

/** `MessageChannel` and `queueMicrotask`, for the scheduling fairness monitor. */
export type SchedulingDeps = {
    MessageChannel : MessageChannelConstructor;
    queueMicrotask : QueueMicrotaskFn;
};

/** The memory source, for the memory monitor. */
export type MemoryDeps = {
    memorySource : MemorySource;
    memoryIntervalMs? : number;
};

/** The Compute Pressure API (Chrome 125 and later). */
export type PressureDeps = {
    PressureObserver : PressureObserverInit;
    pressureSources? : PressureSource[];
    pressureSampleIntervalMs? : number;
};

/** `FinalizationRegistry`, for the GC signal. */
export type GCDeps = {
    FinalizationRegistry : FinalizationRegistryConstructor;
};

/**
 * The worker, for the measurement of main-thread lag from outside the main
 * thread. `PerformanceDeps` is also necessary.
 */
export type WorkerMonitorDeps = {
    worker : WorkerLike;
    workerHeartbeatIntervalMs? : number;
    /** The target of the hang reports that the worker sends while the main thread is blocked. */
    workerHangReport? : HangReportTarget;
    /**
     * The hang journal (`createIndexedDbHangJournal(indexedDB)`). With it, the
     * monitor reports the hangs that earlier pages of the origin did not
     * survive. The worker must have a journal of the same storage. The peer
     * hang watch takes the record of a hung page from it.
     */
    hangJournal? : HangJournal;
    /** The ID of this page instance. The default is a new random ID. */
    pageId? : string;
};

/**
 * `BroadcastChannel` and the Web Locks API (`navigator.locks`), for the peer
 * hang watch: the open pages of an origin watch each other for hangs.
 */
export type PeerDeps = {
    BroadcastChannel : BroadcastChannelConstructor;
    locks : LockManagerLike;
    /** With it, the watch cancels its waiting lock requests when the page is frozen, goes into the back/forward cache or stops. */
    AbortController? : AbortControllerConstructor;
};

/** The crash-report context of Chromium (`window.crashReport`, Chrome 145). */
export type CrashReportContextLike = {
    initialize?(length : number) : unknown;
    set(key : string, value : string) : unknown;
    delete?(key : string) : unknown;
};

/**
 * The context for crash reports. The browser adds the context to the crash
 * reports that it sends to the Reporting endpoint of the page. For example,
 * the browser sends a crash report after it stops an unresponsive page.
 */
export type CrashReportDeps = {
    crashReport : CrashReportContextLike;
};

/** `performance.now()` and `timeOrigin`, for the clock resolution and for timestamps across threads. */
export type PerformanceDeps = {
    performance : PerformanceLike;
};

/**
 * One absolute clock for the page (`createAbsoluteClock`). `setupAllMonitors`
 * makes it from `performance`. A factory without it makes its own clock.
 */
export type AbsoluteClockDeps = {
    absoluteClock : AbsoluteClock;
};

/** The wall clock, to compare with the monotonic clock. */
export type WallClockDeps = {
    wallClock : WallClock;
};

/** The structured-event port for attribution and diagnostics. */
export type EventDeps = {
    events : EventSink;
};

/** The Reporting API, for browser interventions and deprecations. */
export type ReportingDeps = {
    ReportingObserver : ReportingObserverInit;
};

/** The page-view state for the Web Vitals. */
export type PageDeps = {
    /** The document and navigation state. `createPageSource` gets it from the browser. */
    page : PageSource;
    /**
     * A function that makes the short CSS selector of a DOM node, for
     * attribution events. The default is `describeNode`, which makes the
     * same selector as web-vitals.
     */
    describeNode? : (node : unknown) => string;
    /** When true, each soft navigation starts a new page view (Chromium 151 and later). The default is false. */
    softNavigations? : boolean;
    /**
     * A function that gives more attributes for the context of the page, for
     * example `() => ({ "session.id": otel.getSessionId() })`. The worker
     * adds the context to its hang reports, because it sends them without
     * the OpenTelemetry SDK of the page. The monitors read the function at
     * the start of each page view.
     */
    pageContext? : () => Readonly<Record<string, string>>;
};

/**
 * Shared memory for the liveness watcher. Give it only in a
 * cross-origin-isolated page (`globalThis.crossOriginIsolated`).
 */
export type SharedMemoryDeps = {
    SharedArrayBuffer : new (byteLength : number) => SharedArrayBuffer;
};
