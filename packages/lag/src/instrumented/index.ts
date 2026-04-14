/**
 * Instrumented factories — each function constructs a monitor and wires it
 * to OTel instruments (histograms, gauges). Returns a MonitorHandle with
 * error boundary and stop() teardown.
 *
 * Each factory takes ONLY the dep groups it actually uses, enforcing
 * Interface Segregation. Adding a new monitor = adding a new file here + one
 * line in setup-all-monitors.ts.
 */

// Timer-based lag monitors (need shared LifecycleStateMachine param)
export { createInstrumentedDriftLag } from "./drift-lag.js";
export { createInstrumentedMacrotaskLag } from "./macrotask-lag.js";

// PerformanceObserver-based monitors
export { createInstrumentedLoaf } from "./loaf.js";
export { createInstrumentedEventTiming } from "./event-timing.js";
export { createInstrumentedLayoutShift } from "./layout-shift.js";
export { createInstrumentedPaintTiming } from "./paint-timing.js";
export { createInstrumentedLcp } from "./lcp.js";

// Browser-API monitors
export { createInstrumentedFrameTiming } from "./frame-timing.js";
export { createInstrumentedIdleAvailability } from "./idle-availability.js";
export { createInstrumentedSchedulingFairness } from "./scheduling-fairness.js";
export { createInstrumentedMemory } from "./memory.js";

// Ground truth + system signal
export { createInstrumentedWorkerLag } from "./worker-lag.js";
export { createInstrumentedComputePressure } from "./compute-pressure.js";
export { createInstrumentedGCSignal } from "./gc-signal.js";

// Reliability / utility
export { createInstrumentedLifecycle } from "./lifecycle.js";
export {
    createInstrumentedThrottleDetector,
    type ThrottleDetectorDeps,
} from "./throttle-detector.js";
export { createInstrumentedClockReliability } from "./clock-reliability.js";
