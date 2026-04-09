import type { ClearIntervalFn, Clock, Logger, SetIntervalFn, SetTimeoutFn } from "./types.js";
import type { Document } from "./PageHiddenTracker.js";
import type { PerformanceObserverInit } from "./perf-types.js";
import type { WorkerLike } from "./WorkerLagMonitor.js";
import type { PerformanceLike } from "./ClockReliabilityChecker.js";
import type { PageLifecycleDocument, PageLifecycleWindow } from "./PageLifecycleTracker.js";
import type {
    MessageChannelConstructor,
    QueueMicrotaskFn,
    SchedulingMeasurement,
} from "./SchedulingFairnessMonitor.js";
import type {
    RequestAnimationFrameFn,
    CancelAnimationFrameFn,
    FrameMeasurement,
} from "./FrameTimingMonitor.js";
import type {
    RequestIdleCallbackFn,
    CancelIdleCallbackFn,
    IdleMeasurement,
} from "./IdleAvailabilityMonitor.js";
import type { MemorySource, MemoryMeasurement } from "./MemoryMonitor.js";
import type {
    LifecycleDocument,
    LifecycleWindow as LifecycleSmWindow,
} from "./LifecycleStateMachine.js";
import type {
    PressureObserverInit,
    PressureSource,
    PressureMeasurement,
} from "./ComputePressureMonitor.js";
import { setupLagMonitors } from "./setup-lag-monitors.js";
import { setupObserverMonitors, type ObserverMonitorHandles } from "./setup-observer-monitors.js";
import { setupWorkerMonitor } from "./setup-worker-monitor.js";
import { WorkerLagMonitor } from "./WorkerLagMonitor.js";
import { PageLifecycleTracker } from "./PageLifecycleTracker.js";
import { TimerThrottleDetector } from "./TimerThrottleDetector.js";
import { ClockReliabilityChecker } from "./ClockReliabilityChecker.js";
import { GCSpikeDetector } from "./GCSpikeDetector.js";
import {
    GCSignalDetector,
    type FinalizationRegistryConstructor,
} from "./GCSignalDetector.js";
import { SchedulingFairnessMonitor } from "./SchedulingFairnessMonitor.js";
import { FrameTimingMonitor } from "./FrameTimingMonitor.js";
import { IdleAvailabilityMonitor } from "./IdleAvailabilityMonitor.js";
import { MemoryMonitor, defaultMemoryIntervalMs } from "./MemoryMonitor.js";
import { PaintTimingMonitor } from "./PaintTimingMonitor.js";
import { LcpMonitor } from "./LcpMonitor.js";
import { LifecycleStateMachine } from "./LifecycleStateMachine.js";
import { ComputePressureMonitor } from "./ComputePressureMonitor.js";

type Meter = {
    createHistogram : <A>(name : string, options : { unit : string }) => {
        record : (value : number, attributes? : A) => void;
    };
    createObservableGauge : <A>(name : string, options : { unit : string }) => {
        addCallback : (callback : (observableResult : { observe : (value : number, attributes? : A) => void }) => void) => void;
    };
};

const SCHEDULING_FAIRNESS_INTERVAL_MS = 5_000;

export type AllMonitorDeps = {
    document : Document;
    logger : Logger;
    setIntervalFn : SetIntervalFn;
    clearIntervalFn : ClearIntervalFn;
    setTimeoutFn : SetTimeoutFn;
    clearTimeoutFn : ClearIntervalFn;
    clock : Clock;
    meter : Meter;

    // Optional: Performance Observer support
    PerformanceObserver? : PerformanceObserverInit;

    // Optional: Worker support
    worker? : WorkerLike;
    workerPingIntervalMs? : number;

    // Optional: Enhanced lifecycle tracking
    window? : PageLifecycleWindow;
    performance? : PerformanceLike;

    // Optional: Scheduling fairness (microtask vs macrotask vs MessageChannel)
    MessageChannel? : MessageChannelConstructor;
    queueMicrotask? : QueueMicrotaskFn;

    // Optional: Frame timing via requestAnimationFrame
    requestAnimationFrame? : RequestAnimationFrameFn;
    cancelAnimationFrame? : CancelAnimationFrameFn;

    // Optional: Idle availability via requestIdleCallback
    requestIdleCallback? : RequestIdleCallbackFn;
    cancelIdleCallback? : CancelIdleCallbackFn;

    // Optional: Memory sampling
    memorySource? : MemorySource;
    memoryIntervalMs? : number;

    // Optional: Lifecycle state machine (uses document + window for events)
    lifecycleStateMachine? : boolean;

    // Optional: Compute Pressure API (Chrome 125+)
    PressureObserver? : PressureObserverInit;
    pressureSources? : PressureSource[];
    pressureSampleIntervalMs? : number;

    // Optional: Real GC detection via FinalizationRegistry (ES2021)
    FinalizationRegistry? : FinalizationRegistryConstructor;
    gcCanaryIntervalMs? : number;
};

export type AllMonitorHandles = {
    observers : ObserverMonitorHandles | undefined;
    workerMonitor : WorkerLagMonitor | undefined;
    lifecycleTracker : PageLifecycleTracker | undefined;
    throttleDetector : TimerThrottleDetector | undefined;
    clockChecker : ClockReliabilityChecker | undefined;
    gcDetector : GCSpikeDetector;
    schedulingMonitor : SchedulingFairnessMonitor | undefined;
    frameMonitor : FrameTimingMonitor | undefined;
    idleMonitor : IdleAvailabilityMonitor | undefined;
    memoryMonitor : MemoryMonitor | undefined;
    paintMonitor : PaintTimingMonitor | undefined;
    lcpMonitor : LcpMonitor | undefined;
    lifecycleStateMachine : LifecycleStateMachine | undefined;
    pressureMonitor : ComputePressureMonitor | undefined;
    gcSignal : GCSignalDetector | undefined;
    stop() : void;
};

export function setupAllMonitors(deps : AllMonitorDeps) : AllMonitorHandles {
    const {
        document,
        logger,
        setIntervalFn,
        clearIntervalFn,
        setTimeoutFn,
        clearTimeoutFn,
        clock,
        meter,
    } = deps;

    // 1. Always set up the existing timer-based monitors (unchanged behavior)
    setupLagMonitors([
        document,
        logger,
        setIntervalFn,
        clearIntervalFn,
        setTimeoutFn,
        clearTimeoutFn,
        clock,
        meter,
    ]);

    // 2. Performance Observer monitors (LoAF, INP, CLS)
    let observers : ObserverMonitorHandles | undefined;
    if (deps.PerformanceObserver) {
        observers = setupObserverMonitors({
            logger,
            PerformanceObserver : deps.PerformanceObserver,
            meter,
        });
    }

    // 3. Worker monitor
    let workerMonitor : WorkerLagMonitor | undefined;
    if (deps.worker) {
        workerMonitor = setupWorkerMonitor({
            worker : deps.worker,
            logger,
            setIntervalFn,
            clearIntervalFn,
            clock,
            meter,
            ...(deps.workerPingIntervalMs !== undefined && { pingIntervalMs : deps.workerPingIntervalMs }),
        });
    }

    // 4. Enhanced lifecycle tracking
    let lifecycleTracker : PageLifecycleTracker | undefined;
    if (deps.window) {
        lifecycleTracker = new PageLifecycleTracker(
            deps.document as PageLifecycleDocument,
            deps.window,
            logger,
        );
    }

    // 5. Timer throttle detection
    const throttleDetector = new TimerThrottleDetector(setTimeoutFn, clock, logger);
    throttleDetector.start();

    // 6. Clock reliability
    let clockChecker : ClockReliabilityChecker | undefined;
    if (deps.performance) {
        clockChecker = new ClockReliabilityChecker(deps.performance);
    }

    // 7. GC spike detection
    const gcDetector = new GCSpikeDetector();

    // 8. Scheduling fairness (MessageChannel + queueMicrotask + setTimeout)
    let schedulingMonitor : SchedulingFairnessMonitor | undefined;
    if (deps.MessageChannel && deps.queueMicrotask) {
        const microtaskHist = meter.createHistogram<SchedulingMeasurement>(
            "lag_scheduling_microtask_histogram", { unit : "ms" });
        const macrotaskHist = meter.createHistogram<SchedulingMeasurement>(
            "lag_scheduling_macrotask_histogram", { unit : "ms" });
        const messageChannelHist = meter.createHistogram<SchedulingMeasurement>(
            "lag_scheduling_message_channel_histogram", { unit : "ms" });

        schedulingMonitor = new SchedulingFairnessMonitor(
            SCHEDULING_FAIRNESS_INTERVAL_MS,
            (m : SchedulingMeasurement) => {
                microtaskHist.record(m.microtaskMs, m);
                macrotaskHist.record(m.macrotaskMs, m);
                messageChannelHist.record(m.messageChannelMs, m);
            },
            logger,
            setIntervalFn,
            clearIntervalFn,
            setTimeoutFn,
            deps.queueMicrotask,
            deps.MessageChannel,
            clock,
        );
    }

    // 9. Frame timing via requestAnimationFrame
    let frameMonitor : FrameTimingMonitor | undefined;
    if (deps.requestAnimationFrame && deps.cancelAnimationFrame) {
        const frameDeltaHist = meter.createHistogram<FrameMeasurement>(
            "lag_frame_delta_histogram", { unit : "ms" });
        const fpsGauge = meter.createObservableGauge<Record<string, never>>(
            "lag_frame_fps_gauge", { unit : "fps" });
        const droppedRateGauge = meter.createObservableGauge<Record<string, never>>(
            "lag_frame_dropped_rate_gauge", { unit : "ratio" });

        let lastFps = 0;
        let currentFrameMonitor : FrameTimingMonitor | undefined;
        fpsGauge.addCallback((result) => {
            if (lastFps > 0) result.observe(lastFps);
        });
        droppedRateGauge.addCallback((result) => {
            if (currentFrameMonitor) {
                result.observe(currentFrameMonitor.getDroppedFrameRate());
            }
        });

        frameMonitor = new FrameTimingMonitor(
            (m : FrameMeasurement) => {
                frameDeltaHist.record(m.frameDeltaMs, m);
                lastFps = m.fps;
            },
            logger,
            deps.requestAnimationFrame,
            deps.cancelAnimationFrame,
            clock,
        );
        currentFrameMonitor = frameMonitor;
    }

    // 10. Idle availability via requestIdleCallback
    let idleMonitor : IdleAvailabilityMonitor | undefined;
    if (deps.requestIdleCallback && deps.cancelIdleCallback) {
        const idleRemainingHist = meter.createHistogram<IdleMeasurement>(
            "lag_idle_time_remaining_histogram", { unit : "ms" });
        const idleGapHist = meter.createHistogram<IdleMeasurement>(
            "lag_idle_gap_histogram", { unit : "ms" });
        const timeoutRateGauge = meter.createObservableGauge<Record<string, never>>(
            "lag_idle_timeout_rate_gauge", { unit : "ratio" });

        let currentIdleMonitor : IdleAvailabilityMonitor | undefined;
        timeoutRateGauge.addCallback((result) => {
            if (currentIdleMonitor) {
                result.observe(currentIdleMonitor.getTimeoutRate());
            }
        });

        idleMonitor = new IdleAvailabilityMonitor(
            (m : IdleMeasurement) => {
                idleRemainingHist.record(m.timeRemainingMs, m);
                if (m.timeSinceLastIdleMs > 0) {
                    idleGapHist.record(m.timeSinceLastIdleMs, m);
                }
            },
            logger,
            deps.requestIdleCallback,
            deps.cancelIdleCallback,
            clock,
        );
        currentIdleMonitor = idleMonitor;
    }

    // 11. Memory monitor
    let memoryMonitor : MemoryMonitor | undefined;
    if (deps.memorySource) {
        const memoryUsedHist = meter.createHistogram<MemoryMeasurement>(
            "lag_memory_used_bytes_histogram", { unit : "By" });
        const memoryUsagePercentGauge = meter.createObservableGauge<Record<string, never>>(
            "lag_memory_usage_percent_gauge", { unit : "%" });

        let lastMeasurement : MemoryMeasurement | undefined;
        memoryUsagePercentGauge.addCallback((result) => {
            if (lastMeasurement?.usagePercent !== undefined) {
                result.observe(lastMeasurement.usagePercent);
            }
        });

        memoryMonitor = new MemoryMonitor(
            deps.memoryIntervalMs ?? defaultMemoryIntervalMs,
            deps.memorySource,
            (m : MemoryMeasurement) => {
                memoryUsedHist.record(m.usedBytes, m);
                lastMeasurement = m;
            },
            logger,
            setIntervalFn,
            clearIntervalFn,
            clock,
        );
    }

    // 12. Paint timing (FP, FCP) - one-shot, but observed via PerformanceObserver
    let paintMonitor : PaintTimingMonitor | undefined;
    if (deps.PerformanceObserver) {
        const fpGauge = meter.createObservableGauge<Record<string, never>>(
            "lag_paint_first_paint_gauge", { unit : "ms" });
        const fcpGauge = meter.createObservableGauge<Record<string, never>>(
            "lag_paint_first_contentful_paint_gauge", { unit : "ms" });

        let currentPaintMonitor : PaintTimingMonitor | undefined;
        fpGauge.addCallback((result) => {
            if (currentPaintMonitor) {
                const v = currentPaintMonitor.getFirstPaint();
                if (v >= 0) result.observe(v);
            }
        });
        fcpGauge.addCallback((result) => {
            if (currentPaintMonitor) {
                const v = currentPaintMonitor.getFirstContentfulPaint();
                if (v >= 0) result.observe(v);
            }
        });

        paintMonitor = new PaintTimingMonitor(
            () => {},
            logger,
            deps.PerformanceObserver,
        );
        currentPaintMonitor = paintMonitor;
    }

    // 13. LCP monitor
    let lcpMonitor : LcpMonitor | undefined;
    if (deps.PerformanceObserver) {
        const lcpGauge = meter.createObservableGauge<Record<string, never>>(
            "lag_lcp_gauge", { unit : "ms" });

        let currentLcpMonitor : LcpMonitor | undefined;
        lcpGauge.addCallback((result) => {
            if (currentLcpMonitor) {
                const v = currentLcpMonitor.getLCP();
                if (v > 0) result.observe(v);
            }
        });

        lcpMonitor = new LcpMonitor(
            () => {},
            logger,
            deps.PerformanceObserver,
        );
        currentLcpMonitor = lcpMonitor;
    }

    // 14. Lifecycle state machine (mark/resolve API)
    let lifecycleStateMachine : LifecycleStateMachine | undefined;
    if (deps.lifecycleStateMachine && deps.window) {
        const transitionCounter = meter.createHistogram<{ from : string; to : string; trigger : string }>(
            "lag_lifecycle_transition_count_histogram",
            { unit : "count" },
        );
        lifecycleStateMachine = new LifecycleStateMachine(
            deps.document as LifecycleDocument,
            deps.window as LifecycleSmWindow,
            clock,
            logger,
        );
        // Periodically poll for new transitions and record metrics. Use a single
        // long-lived mark; we resolve & re-mark on each poll.
        let mark = lifecycleStateMachine.mark();
        const transitionInterval = setIntervalFn(() => {
            const transitions = lifecycleStateMachine!.resolve(mark);
            for (const t of transitions) {
                if (t.trigger !== "init") {
                    transitionCounter.record(1, { from : t.from, to : t.to, trigger : t.trigger });
                }
            }
            mark = lifecycleStateMachine!.mark();
        }, 5_000);

        // Tear down the polling interval on stop
        const origStop = () => clearIntervalFn(transitionInterval);
        // Attach to closure for the outer stop() to call
        (lifecycleStateMachine as unknown as { __stopPoll : () => void }).__stopPoll = origStop;
    }

    // 15. Compute Pressure API (Chrome 125+)
    let pressureMonitor : ComputePressureMonitor | undefined;
    if (deps.PressureObserver) {
        const pressureGauge = meter.createObservableGauge<Record<string, never>>(
            "lag_pressure_state_gauge",
            { unit : "ordinal" },
        );
        const pressureChangeHist = meter.createHistogram<PressureMeasurement>(
            "lag_pressure_change_histogram",
            { unit : "ordinal" },
        );

        let currentPressureMonitor : ComputePressureMonitor | undefined;
        pressureGauge.addCallback((result) => {
            if (currentPressureMonitor) {
                const ord = currentPressureMonitor.getWorstStateOrdinal();
                if (ord >= 0) result.observe(ord);
            }
        });

        pressureMonitor = new ComputePressureMonitor(
            deps.pressureSources ?? ["cpu"],
            (m) => {
                pressureChangeHist.record(m.stateOrdinal, m);
            },
            logger,
            deps.PressureObserver,
            deps.pressureSampleIntervalMs ?? 1_000,
        );
        currentPressureMonitor = pressureMonitor;
    }

    // 16. GC signal detection via FinalizationRegistry (real GC events)
    let gcSignal : GCSignalDetector | undefined;
    if (deps.FinalizationRegistry) {
        const gcEventCounter = meter.createHistogram<{ source : string }>(
            "lag_gc_event_counter_histogram", { unit : "count" });
        const gcRateGauge = meter.createObservableGauge<Record<string, never>>(
            "lag_gc_recent_rate_gauge", { unit : "events" });

        let currentGcSignal : GCSignalDetector | undefined;
        gcRateGauge.addCallback((result) => {
            if (currentGcSignal) {
                // Events in the last 60 seconds — a useful "is GC active" view
                result.observe(currentGcSignal.getRecentGCEvents(60_000));
            }
        });

        // Wrap GCSignalDetector so we can record events as they happen.
        // We do this by patching the registry construction to record metrics.
        const wrappedFR = function <T>(this : unknown, cleanup : (held : T) => void) {
            const originalRegistry = new deps.FinalizationRegistry!<T>((held : T) => {
                gcEventCounter.record(1, { source : "canary" });
                cleanup(held);
            });
            return originalRegistry;
        } as unknown as FinalizationRegistryConstructor;

        gcSignal = new GCSignalDetector(
            wrappedFR,
            clock,
            setIntervalFn,
            clearIntervalFn,
            logger,
            deps.gcCanaryIntervalMs ?? 250,
        );
        currentGcSignal = gcSignal;
    }

    return {
        observers,
        workerMonitor,
        lifecycleTracker,
        throttleDetector,
        clockChecker,
        gcDetector,
        schedulingMonitor,
        frameMonitor,
        idleMonitor,
        memoryMonitor,
        paintMonitor,
        lcpMonitor,
        lifecycleStateMachine,
        pressureMonitor,
        gcSignal,
        stop() {
            observers?.stop();
            workerMonitor?.stop();
            throttleDetector?.stop();
            schedulingMonitor?.stop();
            frameMonitor?.stop();
            idleMonitor?.stop();
            memoryMonitor?.stop();
            paintMonitor?.stop();
            lcpMonitor?.stop();
            (lifecycleStateMachine as unknown as { __stopPoll? : () => void } | undefined)?.__stopPoll?.();
            pressureMonitor?.stop();
            gcSignal?.stop();
        },
    };
}
