// --- Timer-based lag monitors ---
export { DriftLag, type DriftLagOptions } from "./DriftLag.js";
export { MacrotaskLag } from "./MacrotaskLag.js";
export { createMessageTaskQueue, type MessageTaskQueue, type PostTaskFn } from "./message-task.js";
export { BusyTimeProbe } from "./BusyTimeProbe.js";
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

// --- Metrics, events and the OpenTelemetry adapters ---
export type {
    Meter,
    Histogram,
    Counter,
    InstrumentOptions,
    InstrumentAdvice,
    Attributes,
    AttributeValue,
} from "./meter.js";
export { createNoopMeter } from "./noop-meter.js";
export {
    createOtelLoggerAdapter,
    createOtelEventSink,
    createTeeLogger,
    type OtelLogger,
    type OtelEventSinkOptions,
} from "./otel-logger-adapter.js";
export {
    createNoopEventSink,
    withEventContext,
    placeEventTime,
    MAX_EVENT_TIME_OFFSET_MS,
    EVENT_TIME_ATTRIBUTE,
    type EventSink,
    type EventAttributes,
    type EventOptions,
} from "./events.js";
export {
    createNoopSpanSink,
    isSpanIdentity,
    type SpanSink,
    type SpanIdentity,
    type SpanOptions,
    type OpenSpan,
} from "./spans.js";
export {
    createOtelSpanSink,
    type OtelTracerLike,
    type OtelTraceApiLike,
    type OtelSpanLike,
    type OtelSpanContext,
} from "./otel-span-adapter.js";
export { createPageViewSpans, type PageViewSpans } from "./instrumented/page-view-spans.js";
export {
    METRICS,
    METRIC_CATALOG,
    EVENTS,
    EVENT_CATALOG,
    SPANS,
    SPAN_CATALOG,
    HISTOGRAM_BOUNDARIES,
    createCounter,
    createHistogram,
    type MetricDefinition,
    type MetricKind,
    type MetricKey,
    type EventDefinition,
    type EventKey,
    type SpanDefinition,
    type SpanKey,
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
    SpanDeps,
    ReportingDeps,
    SharedMemoryDeps,
    PageDeps,
    PeerDeps,
    AbsoluteClockDeps,
    CrashReportDeps,
    CrashReportContextLike,
} from "./dep-groups.js";

// --- PerformanceObserver monitors ---
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

// --- Scheduling, frame, idle and memory monitors ---
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

// --- Lifecycle, pressure, timers, clocks, reports and GC ---
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

// --- The worker monitor, the worker protocol and the hang journal ---
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
export {
    PeerHangWatch,
    isPeerMessage,
    peerLockName,
    PEER_CHANNEL_NAME,
    PEER_BEAT_INTERVAL_MS,
    PEER_HANG_THRESHOLD_MS,
    PEER_GRACE_MS,
    PEER_CLAIM_HOLD_MS,
    type PeerMessage,
    type PeerHangWatchDeps,
    type PeerHangWatchOptions,
    type BroadcastChannelLike,
    type BroadcastChannelConstructor,
    type LockManagerLike,
    type AbortSignalLike,
    type AbortControllerLike,
    type AbortControllerConstructor,
} from "./PeerHangWatch.js";
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

// --- Setup and the browser adapter ---
export { setupAllMonitors, type AllMonitorDeps, type AllMonitorHandles } from "./setup-all-monitors.js";
export { createBrowserDeps, type BrowserGlobals, type BrowserDepsOptions } from "./browser/browser-deps.js";
export { createPageSource, type PageDocument, type PagePerformance } from "./browser/page-source.js";
export { createIndexedDbHangJournal, type IdbFactoryLike } from "./browser/indexeddb-journal.js";
export {
    createMemoryHangJournal,
    findAbandonedHangs,
    HANG_JOURNAL_STALE_MS,
    HANG_JOURNAL_WRITE_INTERVAL_MS,
    createStorageHangReportMarks,
    HANG_REPORT_MARK_PREFIX,
    type HangJournal,
    type HangRecord,
    type HangReportMarks,
    type StorageLike,
} from "./hang-journal.js";
export { createRandomId } from "./random-id.js";

// --- The instrumented factories: one for each monitor, each gives a MonitorHandle ---
export * from "./instrumented/index.js";
