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
