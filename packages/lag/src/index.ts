// --- Original exports ---
export { DriftLag } from "./DriftLag.js";
export { MacrotaskLag } from "./MacrotaskLag.js";
export { LagMonitor, type LagMonitorConstructor } from "./LagMonitor.js";
export { LagLogger } from "./LagLogger.js";
export { setupLagMonitors } from "./setup-lag-monitors.js";
export type {
    Logger,
    SetTimeoutFn,
    ClearTimeoutFn,
    SetIntervalFn,
    ClearIntervalFn,
    Clock,
    LagMeasurement,
    EventLoopLagAttributes,
} from "./types.js";
export {
    driftStepMs,
    shortLagThreshold,
    longLagThreshold,
    maxLagBuffer,
    macrotaskLagIntervalMs,
    highFrequencyLagIntervalMs,
    shortLagDuration,
    longLagDuration,
    lagLoggingIntervalMs,
} from "./constants.js";

// --- Phase 1: OTel integration ---
export { createNoopMeter } from "./noop-meter.js";
export { createOtelLoggerAdapter, createTeeLogger, type OtelLogger } from "./otel-logger-adapter.js";

// --- Phase 2: Performance Observer monitors ---
export { ObserverMonitor } from "./ObserverMonitor.js";
export { LongAnimationFrameMonitor, type LoafReport } from "./LongAnimationFrameMonitor.js";
export { EventTimingMonitor, type EventTimingReport } from "./EventTimingMonitor.js";
export { LayoutShiftMonitor, type LayoutShiftReport } from "./LayoutShiftMonitor.js";
export { PaintTimingMonitor, type PaintReport } from "./PaintTimingMonitor.js";
export { LcpMonitor, type LcpReport } from "./LcpMonitor.js";
export { setupObserverMonitors, type ObserverMonitorHandles } from "./setup-observer-monitors.js";
export type {
    PerformanceEntryLike,
    PerformanceObserverInit,
    PerformanceObserverInstance,
    PerformanceEntryList,
    LoafEntry,
    LoafScriptEntry,
    EventTimingEntry,
    LayoutShiftEntry,
    LayoutShiftSource,
    PaintEntry,
    LcpEntry,
} from "./perf-types.js";

// --- Additional monitors (scheduling, frame, idle, memory) ---
export {
    SchedulingFairnessMonitor,
    type SchedulingMeasurement,
    type MessageChannelLike,
    type MessageChannelConstructor,
    type MessagePortLike,
    type QueueMicrotaskFn,
} from "./SchedulingFairnessMonitor.js";
export {
    FrameTimingMonitor,
    type FrameMeasurement,
    type RequestAnimationFrameFn,
    type CancelAnimationFrameFn,
} from "./FrameTimingMonitor.js";
export {
    IdleAvailabilityMonitor,
    type IdleMeasurement,
    type IdleDeadline,
    type RequestIdleCallbackFn,
    type CancelIdleCallbackFn,
} from "./IdleAvailabilityMonitor.js";
export {
    MemoryMonitor,
    defaultMemoryIntervalMs,
    type MemoryMeasurement,
    type MemorySource,
    type LegacyMemory,
    type MeasureMemoryResult,
} from "./MemoryMonitor.js";

// --- Phase 3: Measurement reliability ---
export {
    LifecycleStateMachine,
    summarizeTransitions,
    type LifecycleState,
    type LifecycleTrigger,
    type StateTransition,
    type LifecycleMark,
    type LifecycleSummary,
    type LifecycleDocument,
    type LifecycleWindow,
    type LifecycleEventTarget,
} from "./LifecycleStateMachine.js";
export {
    ComputePressureMonitor,
    pressureStateOrdinals,
    type PressureState,
    type PressureSource,
    type PressureRecord,
    type PressureObserverInstance,
    type PressureObserverInit,
    type PressureMeasurement,
} from "./ComputePressureMonitor.js";
export { TimerThrottleDetector, type TimerThrottleConfig } from "./TimerThrottleDetector.js";
export { ClockReliabilityChecker, type PerformanceLike } from "./ClockReliabilityChecker.js";
export { GCSpikeDetector } from "./GCSpikeDetector.js";
export {
    GCSignalDetector,
    type FinalizationRegistryConstructor,
    type FinalizationRegistryInstance,
} from "./GCSignalDetector.js";

// --- Phase 4: Web Worker monitor ---
export { WorkerLagMonitor, type WorkerLike, type WorkerLagMeasurement } from "./WorkerLagMonitor.js";
export { createWorkerHandler, type WorkerDeps } from "./lag-worker.js";
export { setupWorkerMonitor } from "./setup-worker-monitor.js";
export type { MainToWorkerMessage, WorkerToMainMessage, PingMessage, PongMessage, ConfigMessage, StopMessage } from "./worker-protocol.js";

// --- Phase 5: Unified setup ---
export { setupAllMonitors, type AllMonitorDeps, type AllMonitorHandles } from "./setup-all-monitors.js";
