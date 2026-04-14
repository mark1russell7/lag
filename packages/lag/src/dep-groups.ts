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
    SetTimeoutFn,
    ClearTimeoutFn,
    SetIntervalFn,
    ClearIntervalFn,
} from "./types.js";
import type { Meter } from "./meter.js";
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
import type {
    LifecycleDocument,
    LifecycleWindow,
} from "./LifecycleStateMachine.js";
import type { PerformanceLike } from "./ClockReliabilityChecker.js";

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
    gcCanaryIntervalMs? : number;
};

/** Worker-based ground-truth lag monitoring. */
export type WorkerMonitorDeps = {
    worker : WorkerLike;
    workerPingIntervalMs? : number;
};

/** Clock reliability utilities. */
export type ClockReliabilityDeps = {
    performance : PerformanceLike;
};
