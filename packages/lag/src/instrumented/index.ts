/**
 * Instrumented factories — each function constructs a monitor and wires it
 * to OTel instruments from the metric catalog. Returns a MonitorHandle with
 * an error boundary and a stop() that releases timers, listeners and
 * observers.
 *
 * Each factory takes ONLY the dep groups it actually uses. Timer-driven
 * factories also take optional MeasurementConditions to pause while the page
 * is hidden and to discard invalid samples. Adding a new monitor = adding a
 * new file here + one line in setup-all-monitors.ts + its metrics in the
 * catalog.
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
