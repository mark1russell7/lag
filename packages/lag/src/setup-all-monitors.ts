/**
 * Unified setup — orchestrates the monitor registry.
 *
 * This replaces the former "god function" with thin coordination:
 *   1. Create a MonitorRegistry
 *   2. Construct the lifecycle state machine (shared dependency)
 *   3. Add instrumented factories to the registry, each guarded by the
 *      presence of their respective capability deps
 *   4. Return handles + a `stop()` that tears down the whole registry
 *
 * Adding a new monitor is a one-liner — no modifications elsewhere.
 */

import type {
    CoreDeps,
    TimerDeps,
    LifecycleDeps,
    ObserverDeps,
    FrameDeps,
    IdleDeps,
    SchedulingDeps,
    MemoryDeps,
    PressureDeps,
    GCDeps,
    WorkerMonitorDeps,
    ClockReliabilityDeps,
} from "./dep-groups.js";
import { MonitorRegistry } from "./monitor-registry.js";

import { GCSpikeDetector } from "./GCSpikeDetector.js";

// Monitor class types (for typed accessors on AllMonitorHandles)
import type { DriftLag } from "./DriftLag.js";
import type { MacrotaskLag } from "./MacrotaskLag.js";
import type { LongAnimationFrameMonitor } from "./LongAnimationFrameMonitor.js";
import type { EventTimingMonitor } from "./EventTimingMonitor.js";
import type { LayoutShiftMonitor } from "./LayoutShiftMonitor.js";
import type { PaintTimingMonitor } from "./PaintTimingMonitor.js";
import type { LcpMonitor } from "./LcpMonitor.js";
import type { FrameTimingMonitor } from "./FrameTimingMonitor.js";
import type { IdleAvailabilityMonitor } from "./IdleAvailabilityMonitor.js";
import type { SchedulingFairnessMonitor } from "./SchedulingFairnessMonitor.js";
import type { MemoryMonitor } from "./MemoryMonitor.js";
import type { WorkerLagMonitor } from "./WorkerLagMonitor.js";
import type { ComputePressureMonitor } from "./ComputePressureMonitor.js";
import type { GCSignalDetector } from "./GCSignalDetector.js";
import type { LifecycleStateMachine } from "./LifecycleStateMachine.js";
import type { TimerThrottleDetector } from "./TimerThrottleDetector.js";
import type { ClockReliabilityChecker } from "./ClockReliabilityChecker.js";

// Instrumented factories
import {
    createInstrumentedDriftLag,
    createInstrumentedMacrotaskLag,
    createInstrumentedLoaf,
    createInstrumentedEventTiming,
    createInstrumentedLayoutShift,
    createInstrumentedPaintTiming,
    createInstrumentedLcp,
    createInstrumentedFrameTiming,
    createInstrumentedIdleAvailability,
    createInstrumentedSchedulingFairness,
    createInstrumentedMemory,
    createInstrumentedWorkerLag,
    createInstrumentedComputePressure,
    createInstrumentedGCSignal,
    createInstrumentedLifecycle,
    createInstrumentedThrottleDetector,
    createInstrumentedClockReliability,
} from "./instrumented/index.js";

/**
 * Full dependency bag for setupAllMonitors.
 *
 * Required: CoreDeps (logger, clock, meter) + TimerDeps + LifecycleDeps.
 * Everything else is optional, enabled by the presence of its capability deps.
 */
export type AllMonitorDeps =
    & CoreDeps
    & TimerDeps
    & LifecycleDeps
    & Partial<ObserverDeps>
    & Partial<FrameDeps>
    & Partial<IdleDeps>
    & Partial<SchedulingDeps>
    & Partial<MemoryDeps>
    & Partial<PressureDeps>
    & Partial<GCDeps>
    & Partial<WorkerMonitorDeps>
    & Partial<ClockReliabilityDeps>;

/**
 * Handles returned by setupAllMonitors.
 *
 * The `registry` is the source of truth — typed getters are convenience
 * accessors for consumers who want to grab a specific monitor by name.
 * They return `undefined` if that monitor wasn't registered (missing deps)
 * or failed to construct.
 */
export type AllMonitorHandles = {
    /** Registry of all created handles. Use `registry.get(name)` for lookup. */
    readonly registry : MonitorRegistry;

    /** Stateless GC-spike classifier — always available, no setup deps. */
    readonly gcDetector : GCSpikeDetector;

    /** Tear down every registered monitor in LIFO order. */
    stop() : void;

    // Typed accessors — each is lazy via getter so they stay in sync with the registry
    readonly driftLag : DriftLag | undefined;
    readonly macrotaskLag : MacrotaskLag | undefined;
    readonly lifecycleStateMachine : LifecycleStateMachine | undefined;
    readonly loafMonitor : LongAnimationFrameMonitor | undefined;
    readonly eventTimingMonitor : EventTimingMonitor | undefined;
    readonly layoutShiftMonitor : LayoutShiftMonitor | undefined;
    readonly paintMonitor : PaintTimingMonitor | undefined;
    readonly lcpMonitor : LcpMonitor | undefined;
    readonly frameMonitor : FrameTimingMonitor | undefined;
    readonly idleMonitor : IdleAvailabilityMonitor | undefined;
    readonly schedulingMonitor : SchedulingFairnessMonitor | undefined;
    readonly memoryMonitor : MemoryMonitor | undefined;
    readonly workerMonitor : WorkerLagMonitor | undefined;
    readonly pressureMonitor : ComputePressureMonitor | undefined;
    readonly gcSignal : GCSignalDetector | undefined;
    readonly throttleDetector : TimerThrottleDetector | undefined;
    readonly clockChecker : ClockReliabilityChecker | undefined;
};

function monitorOf<T>(registry : MonitorRegistry, name : string) : T | undefined {
    return registry.get<T>(name)?.monitor;
}

export function setupAllMonitors(deps : AllMonitorDeps) : AllMonitorHandles {
    const registry = new MonitorRegistry();

    // 1. Lifecycle first — the lag monitors need it for hidden filtering
    const lifecycleHandle = registry.add(createInstrumentedLifecycle(deps));
    const lifecycle = lifecycleHandle.monitor;

    // 2. Timer-based lag (require lifecycle)
    if (lifecycle) {
        registry.add(createInstrumentedDriftLag(deps, lifecycle));
        registry.add(createInstrumentedMacrotaskLag(deps, lifecycle));
    }

    // 3. Throttle detector — always available (pure timer math)
    registry.add(createInstrumentedThrottleDetector({
        logger : deps.logger,
        clock : deps.clock,
        meter : deps.meter,
        setTimeoutFn : deps.setTimeoutFn,
    }));

    // 4. PerformanceObserver monitors
    if (deps.PerformanceObserver) {
        const observerDeps = {
            ...deps,
            PerformanceObserver : deps.PerformanceObserver,
        };
        registry.add(createInstrumentedLoaf(observerDeps));
        registry.add(createInstrumentedEventTiming(observerDeps));
        registry.add(createInstrumentedLayoutShift(observerDeps));
        registry.add(createInstrumentedPaintTiming(observerDeps));
        registry.add(createInstrumentedLcp(observerDeps));
    }

    // 5. Frame timing (requestAnimationFrame)
    if (deps.requestAnimationFrame && deps.cancelAnimationFrame) {
        registry.add(createInstrumentedFrameTiming({
            ...deps,
            requestAnimationFrame : deps.requestAnimationFrame,
            cancelAnimationFrame : deps.cancelAnimationFrame,
        }));
    }

    // 6. Idle availability (requestIdleCallback)
    if (deps.requestIdleCallback && deps.cancelIdleCallback) {
        registry.add(createInstrumentedIdleAvailability({
            ...deps,
            requestIdleCallback : deps.requestIdleCallback,
            cancelIdleCallback : deps.cancelIdleCallback,
        }));
    }

    // 7. Scheduling fairness (MessageChannel + queueMicrotask)
    if (deps.MessageChannel && deps.queueMicrotask) {
        registry.add(createInstrumentedSchedulingFairness({
            ...deps,
            MessageChannel : deps.MessageChannel,
            queueMicrotask : deps.queueMicrotask,
        }));
    }

    // 8. Memory sampling
    if (deps.memorySource) {
        registry.add(createInstrumentedMemory({
            ...deps,
            memorySource : deps.memorySource,
        }));
    }

    // 9. Worker ground-truth
    if (deps.worker) {
        registry.add(createInstrumentedWorkerLag({
            ...deps,
            worker : deps.worker,
        }));
    }

    // 10. Compute Pressure API
    if (deps.PressureObserver) {
        registry.add(createInstrumentedComputePressure({
            ...deps,
            PressureObserver : deps.PressureObserver,
        }));
    }

    // 11. Real GC signal via FinalizationRegistry
    if (deps.FinalizationRegistry) {
        registry.add(createInstrumentedGCSignal({
            ...deps,
            FinalizationRegistry : deps.FinalizationRegistry,
        }));
    }

    // 12. Clock reliability (requires performance.now + timeOrigin)
    if (deps.performance) {
        registry.add(createInstrumentedClockReliability({
            ...deps,
            performance : deps.performance,
        }));
    }

    return {
        registry,
        gcDetector : new GCSpikeDetector(),
        stop : () => registry.stopAll(),

        get driftLag() { return monitorOf<DriftLag>(registry, "drift-lag"); },
        get macrotaskLag() { return monitorOf<MacrotaskLag>(registry, "macrotask-lag"); },
        get lifecycleStateMachine() { return monitorOf<LifecycleStateMachine>(registry, "lifecycle"); },
        get loafMonitor() { return monitorOf<LongAnimationFrameMonitor>(registry, "loaf"); },
        get eventTimingMonitor() { return monitorOf<EventTimingMonitor>(registry, "event-timing"); },
        get layoutShiftMonitor() { return monitorOf<LayoutShiftMonitor>(registry, "layout-shift"); },
        get paintMonitor() { return monitorOf<PaintTimingMonitor>(registry, "paint-timing"); },
        get lcpMonitor() { return monitorOf<LcpMonitor>(registry, "lcp"); },
        get frameMonitor() { return monitorOf<FrameTimingMonitor>(registry, "frame-timing"); },
        get idleMonitor() { return monitorOf<IdleAvailabilityMonitor>(registry, "idle-availability"); },
        get schedulingMonitor() { return monitorOf<SchedulingFairnessMonitor>(registry, "scheduling-fairness"); },
        get memoryMonitor() { return monitorOf<MemoryMonitor>(registry, "memory"); },
        get workerMonitor() { return monitorOf<WorkerLagMonitor>(registry, "worker-lag"); },
        get pressureMonitor() { return monitorOf<ComputePressureMonitor>(registry, "compute-pressure"); },
        get gcSignal() { return monitorOf<GCSignalDetector>(registry, "gc-signal"); },
        get throttleDetector() { return monitorOf<TimerThrottleDetector>(registry, "throttle-detector"); },
        get clockChecker() { return monitorOf<ClockReliabilityChecker>(registry, "clock-reliability"); },
    };
}
