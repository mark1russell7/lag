// --- Original exports (unchanged) ---
export { ContinuousLag } from "./ContinuousLag.js";
export { DriftLag } from "./DriftLag.js";
export { MacrotaskLag } from "./MacrotaskLag.js";
export { LagMonitor, type LagMonitorConstructor } from "./LagMonitor.js";
export { LagLogger } from "./LagLogger.js";
export { PageHiddenTracker, type Document } from "./PageHiddenTracker.js";
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

// --- Phase 2: Performance Observer monitors ---
export { ObserverMonitor } from "./ObserverMonitor.js";
export { LongAnimationFrameMonitor, type LoafReport } from "./LongAnimationFrameMonitor.js";
export { EventTimingMonitor, type EventTimingReport } from "./EventTimingMonitor.js";
export { LayoutShiftMonitor, type LayoutShiftReport } from "./LayoutShiftMonitor.js";
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
} from "./perf-types.js";

// --- Phase 3: Measurement reliability ---
export { PageLifecycleTracker, type PageLifecycleDocument, type PageLifecycleWindow, type PageLifecycleState } from "./PageLifecycleTracker.js";
export { TimerThrottleDetector } from "./TimerThrottleDetector.js";
export { ClockReliabilityChecker, type PerformanceLike } from "./ClockReliabilityChecker.js";
export { GCSpikeDetector } from "./GCSpikeDetector.js";

// --- Phase 4: Web Worker monitor ---
export { WorkerLagMonitor, type WorkerLike, type WorkerLagMeasurement } from "./WorkerLagMonitor.js";
export { createWorkerHandler, type WorkerDeps } from "./lag-worker.js";
export { setupWorkerMonitor } from "./setup-worker-monitor.js";
export type { MainToWorkerMessage, WorkerToMainMessage, PingMessage, PongMessage, ConfigMessage, StopMessage } from "./worker-protocol.js";

// --- Phase 5: Unified setup ---
export { setupAllMonitors, type AllMonitorDeps, type AllMonitorHandles } from "./setup-all-monitors.js";
