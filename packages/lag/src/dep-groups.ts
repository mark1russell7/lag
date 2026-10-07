/**
 * Capability-based dependency groups.
 *
 * Each group describes one axis of functionality that a monitor might need.
 * Instrumented factories compose the groups they require via intersection
 * types — e.g. `FrameDeps & CoreDeps` — instead of taking a flat bag of ~25
 * fields. This makes each factory's dependencies explicit and enforces ISP
 * (Interface Segregation): consumers who don't use FrameTiming never have to
 * know about `requestAnimationFrame`.
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
import type { ReportingObserverInit } from "./BrowserReportMonitor.js";
import type { PageSource } from "./vitals/types.js";
import type { AbsoluteClock } from "./absolute-clock.js";
import type {
    LifecycleDocument,
    LifecycleWindow,
} from "./LifecycleStateMachine.js";

/** Core deps every instrumented monitor needs. */
export type CoreDeps = {
    logger : Logger;
    clock : Clock;
    meter : Meter;
};

/** Timer scheduling primitives. */
export type TimerDeps = {
    setTimeoutFn : SetTimeoutFn;
    clearTimeoutFn : ClearTimeoutFn;
    setIntervalFn : SetIntervalFn;
    clearIntervalFn : ClearIntervalFn;
};

/** Browser document/window for lifecycle tracking. */
export type LifecycleDeps = {
    document : LifecycleDocument;
    window : LifecycleWindow;
};

/** PerformanceObserver support for LoAF, Event Timing, Layout Shift, Paint, LCP. */
export type ObserverDeps = {
    PerformanceObserver : PerformanceObserverInit;
};

/** Animation frame timing. */
export type FrameDeps = {
    requestAnimationFrame : RequestAnimationFrameFn;
    cancelAnimationFrame : CancelAnimationFrameFn;
};

/** Idle callback timing. */
export type IdleDeps = {
    requestIdleCallback : RequestIdleCallbackFn;
    cancelIdleCallback : CancelIdleCallbackFn;
};

/** Scheduling fairness measurement. */
export type SchedulingDeps = {
    MessageChannel : MessageChannelConstructor;
    queueMicrotask : QueueMicrotaskFn;
};

/** Memory sampling. */
export type MemoryDeps = {
    memorySource : MemorySource;
    memoryIntervalMs? : number;
};

/** Compute Pressure API (Chrome 125+). */
export type PressureDeps = {
    PressureObserver : PressureObserverInit;
    pressureSources? : PressureSource[];
    pressureSampleIntervalMs? : number;
};

/** GC signal detection via FinalizationRegistry. */
export type GCDeps = {
    FinalizationRegistry : FinalizationRegistryConstructor;
};

/** Worker-based ground-truth lag monitoring. Also needs PerformanceDeps. */
export type WorkerMonitorDeps = {
    worker : WorkerLike;
    workerHeartbeatIntervalMs? : number;
    /** Where the worker sends hang reports while the main thread is blocked. */
    workerHangReport? : HangReportTarget;
};

/** `performance.now()` + `timeOrigin`: clock resolution and cross-thread timestamps. */
export type PerformanceDeps = {
    performance : PerformanceLike;
};

/**
 * One absolute clock for the page (`createAbsoluteClock`). setupAllMonitors
 * makes it from `performance`. A factory without it makes its own.
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
    /** Makes the short CSS selector of a DOM node for attribution events. The default is the selector of web-vitals. */
    describeNode? : (node : unknown) => string;
    /** When true, each soft navigation starts a new page view (Chromium 151 and later). The default is false. */
    softNavigations? : boolean;
};

/**
 * Shared memory for the liveness watcher. Supply it only in a
 * cross-origin-isolated page (`globalThis.crossOriginIsolated`).
 */
export type SharedMemoryDeps = {
    SharedArrayBuffer : new (byteLength : number) => SharedArrayBuffer;
};
