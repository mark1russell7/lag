/**
 * The instrumented factories. Each function makes a monitor and connects it
 * to the OTel instruments of the metric catalog. Each function gives a
 * `MonitorHandle` with an error boundary, and a `stop()` that releases the
 * timers, listeners and observers.
 *
 * Each factory takes *only* the dependency groups that it uses. The
 * timer-driven factories also take optional `MeasurementConditions`. With
 * them, the monitor pauses while the page is hidden, and it discards the
 * samples that are not valid. To add a monitor, add a file here, one line in
 * `setup-all-monitors.ts`, and its metrics in the catalog.
 */

// Timer-based lag monitors
export { createInstrumentedDriftLag } from "./drift-lag.js";
export { createInstrumentedMacrotaskLag } from "./macrotask-lag.js";

// PerformanceObserver-based monitors
export { createInstrumentedLoaf } from "./loaf.js";
export { createInstrumentedEventTiming } from "./event-timing.js";
export { createInstrumentedLayoutShift } from "./layout-shift.js";
export { createInstrumentedPageViewVitals } from "./page-view-vitals.js";
export {
    createInstrumentedPageViewContext,
    type PageContextReceiver,
    type PageViewContext,
} from "./page-view-context.js";

// Browser-API monitors
export { createInstrumentedFrameTiming } from "./frame-timing.js";
export { createInstrumentedIdleAvailability } from "./idle-availability.js";
export { createInstrumentedSchedulingFairness } from "./scheduling-fairness.js";
export { createInstrumentedMemory } from "./memory.js";
export { createInstrumentedBrowserReports } from "./browser-reports.js";

// Ground truth + system signal
export { createInstrumentedWorkerLag } from "./worker-lag.js";
export { createInstrumentedSharedLiveness } from "./shared-liveness.js";
export { createInstrumentedComputePressure } from "./compute-pressure.js";
export { createInstrumentedGCSignal } from "./gc-signal.js";

// Reliability / utility
export { createInstrumentedLifecycle } from "./lifecycle.js";
export {
    createInstrumentedThrottleDetector,
    type ThrottleDetectorDeps,
} from "./throttle-detector.js";
export { createInstrumentedClockReliability } from "./clock-reliability.js";
export { createInstrumentedClockDrift } from "./clock-drift.js";

// Building blocks for custom factories
export { createHandle, validatedRecorder } from "./shared.js";
