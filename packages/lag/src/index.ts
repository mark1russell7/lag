// --- Original exports ---
export { DriftLag, type DriftLagOptions } from "./DriftLag.js";
export { MacrotaskLag, type PostTaskFn } from "./MacrotaskLag.js";
export { createMessageTaskQueue, type MessageTaskQueue } from "./message-task.js";
export { LagMonitor, type LagMonitorConstructor } from "./LagMonitor.js";
export { LagLogger } from "./LagLogger.js";
export type {
    Logger,
    SetTimeoutFn,
    ClearTimeoutFn,
    SetIntervalFn,
    ClearIntervalFn,
    Clock,
    PerformanceLike,
    WallClock,
    LagMeasurement,
    EventLoopLagAttributes,
} from "./types.js";
export {
    driftStepMs,
    shortLagThreshold,
    longLagThreshold,
    macrotaskLagIntervalMs,
    highFrequencyLagIntervalMs,
    shortLagDuration,
    longLagDuration,
    lagLoggingIntervalMs,
} from "./constants.js";

// --- Phase 1: OTel integration ---
export type {
    Meter,
    Histogram,
    Counter,
    InstrumentOptions,
    Attributes,
    AttributeValue,
} from "./meter.js";
export { createNoopMeter } from "./noop-meter.js";
export {
    createOtelLoggerAdapter,
    createOtelEventSink,
    createTeeLogger,
    type OtelLogger,
} from "./otel-logger-adapter.js";
export { createNoopEventSink, withEventContext, type EventSink, type EventAttributes } from "./events.js";
export {
    METRICS,
    METRIC_CATALOG,
    EVENTS,
    EVENT_CATALOG,
    createCounter,
    createHistogram,
    type MetricDefinition,
    type MetricKind,
    type MetricKey,
    type EventDefinition,
    type EventKey,
} from "./metric-catalog.js";
export { encodeOtlpLogs, millisToUnixNanoString, type OtlpLogRecordInput, type OtlpAttributeValue } from "./otlp-json.js";
export { RateLimiter, stripUrlParameters } from "./rate-limiter.js";

// --- Measurement validity ---
export {
    ReliabilityTracker,
    type UnreliableInterval,
    type UnreliableReason,
} from "./reliability.js";
export {
    createMeasurementConditions,
    type MeasurementConditions,
    type MeasurementConditionsOptions,
    type SampleValidator,
    type Pausable,
    type StallKind,
    type DiscardReason,
} from "./measurement-conditions.js";

// --- Architecture: handles, registry, dep groups ---
export type { MonitorHandle } from "./monitor-handle.js";
export { MonitorRegistry } from "./monitor-registry.js";
export type {
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
    PerformanceDeps,
    WallClockDeps,
    EventDeps,
    ReportingDeps,
    SharedMemoryDeps,
    PageDeps,
    AbsoluteClockDeps,
    CrashReportDeps,
    CrashReportContextLike,
} from "./dep-groups.js";

// --- Phase 2: Performance Observer monitors ---
export { ObserverMonitor } from "./ObserverMonitor.js";
export { LongAnimationFrameMonitor, type LoafReport, type LoafScriptSummary } from "./LongAnimationFrameMonitor.js";
export { EventTimingMonitor, interactionType, type EventTimingReport } from "./EventTimingMonitor.js";
export { InpCalculator } from "./InpCalculator.js";
export { LayoutShiftMonitor, type LayoutShiftReport } from "./LayoutShiftMonitor.js";
export { ClsCalculator } from "./ClsCalculator.js";
export type {
    PerformanceEntryLike,
    PerformanceObserverInit,
    PerformanceObserverInstance,
    PerformanceObserverOptions,
    PerformanceEntryList,
    LoafEntry,
    LoafScriptEntry,
    EventTimingEntry,
    LayoutShiftEntry,
    LayoutShiftSource,
} from "./perf-types.js";

// --- Page-view Web Vitals ---
export { PageViewVitals, type PageViewVitalsDeps, type VitalsReport } from "./vitals/PageViewVitals.js";
export {
    ViewCollector,
    SHORT_INTERACTION_ESTIMATE_MS,
    type PageView,
    type EventEntryLike,
    type LayoutShiftEntryLike,
} from "./vitals/ViewCollector.js";
export { describeNode } from "./vitals/selector.js";
export {
    NAVIGATION_TYPES,
    VITAL_THRESHOLDS,
    rateVital,
    type VitalName,
    type NavigationType,
    type Rating,
    type VitalValue,
    type NavigationInfo,
    type PageSource,
} from "./vitals/types.js";

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
    isVisibleState,
    type LifecycleListener,
    type LifecycleState,
    type LifecycleTrigger,
    type StateTransition,
    type LifecycleMark,
    type LifecycleSummary,
    type LifecycleDocument,
    type LifecycleWindow,
    type LifecycleEventTarget,
    type LifecycleListenerOptions,
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
export { TimerThrottleDetector, type TimerThrottleConfig, type ThrottleCalibration } from "./TimerThrottleDetector.js";
export { ClockDriftMonitor, type ClockDriftSample, type ClockJump, type ClockDriftOptions } from "./ClockDriftMonitor.js";
export { createAbsoluteClock, type AbsoluteClock } from "./absolute-clock.js";
export {
    BrowserReportMonitor,
    type BrowserReport,
    type BrowserReportType,
    type ReportLike,
    type ReportingObserverInit,
    type ReportingObserverInstance,
} from "./BrowserReportMonitor.js";
export { ClockReliabilityChecker } from "./ClockReliabilityChecker.js";
export {
    GCSignalDetector,
    type FinalizationRegistryConstructor,
    type FinalizationRegistryInstance,
} from "./GCSignalDetector.js";

// --- Phase 4: Web Worker monitor ---
export {
    WorkerLagMonitor,
    type WorkerLike,
    type WorkerLagMeasurement,
    type WorkerLagMonitorOptions,
    type WorkerLagEvents,
    type SystemStall,
} from "./WorkerLagMonitor.js";
export { WorkerClockSync, type ClockSyncResult } from "./WorkerClockSync.js";
export { SharedLivenessMonitor, type SharedLivenessOptions } from "./SharedLivenessMonitor.js";
export {
    LivenessWatcher,
    LIVENESS_BUFFER_BYTES,
    beatingSetTimeout,
    createLivenessBeacon,
    type LivenessBeacon,
    type LivenessBlock,
    type LivenessWatcherOptions,
} from "./shared-liveness.js";
export {
    createForwardingMeter,
    createMeterReceiver,
    type ForwardingMeter,
    type ForwardingMeterOptions,
    type ForwardedMetricMessage,
    type ForwardedInstrument,
    type ForwardedRecords,
    type MessageTarget,
} from "./forwarding-meter.js";
export { createWorkerHandler, type WorkerDeps, type WorkerHandler, type HangEvent } from "./lag-worker.js";
export type {
    MainToWorkerMessage,
    WorkerToMainMessage,
    StartMessage,
    StopMessage,
    AckMessage,
    SyncRequestMessage,
    HeartbeatMessage,
    ContextMessage,
    SyncReplyMessage,
    HangEndedMessage,
    LivenessStartMessage,
    LivenessStopMessage,
    LivenessBlockMessage,
    HangOptions,
    HangReportTarget,
} from "./worker-protocol.js";

// --- Phase 5: Unified setup ---
export { setupAllMonitors, type AllMonitorDeps, type AllMonitorHandles } from "./setup-all-monitors.js";
export { createBrowserDeps, type BrowserGlobals, type BrowserDepsOptions } from "./browser/browser-deps.js";
export { createPageSource, type PageDocument, type PagePerformance } from "./browser/page-source.js";
export { createIndexedDbHangJournal, type IdbFactoryLike } from "./browser/indexeddb-journal.js";
export {
    createMemoryHangJournal,
    findAbandonedHangs,
    HANG_JOURNAL_STALE_MS,
    HANG_JOURNAL_WRITE_INTERVAL_MS,
    type HangJournal,
    type HangRecord,
} from "./hang-journal.js";
export { createRandomId } from "./random-id.js";

// --- Instrumented factories (one per monitor, each returns a MonitorHandle) ---
export * from "./instrumented/index.js";
