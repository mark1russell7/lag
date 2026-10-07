/**
 * The metrics of each monitor, for `<MetricTable>`. All rows come from the
 * metric catalog of `@lag/core` (`METRIC_CATALOG`). The factories make their
 * instruments from the same catalog, thus the documentation and the code
 * always agree.
 */
import { METRIC_CATALOG, type MetricDefinition } from "../../../src/adapters/lag-core";
import type { MetricRow } from "../../../src/components/MetricTable/types";

function toRow(definition : MetricDefinition) : MetricRow {
    const attributes = Object.keys(definition.attributes);
    return {
        name : definition.name,
        kind : definition.kind,
        unit : definition.unit,
        ...(attributes.length > 0 ? { attributes } : {}),
        description : definition.description,
    };
}

/** The rows of the metrics that the named monitors emit, in the sequence of the catalog. */
function rowsOf(...monitors : string[]) : readonly MetricRow[] {
    return METRIC_CATALOG.filter(definition => monitors.includes(definition.monitor)).map(toRow);
}

export const driftLagMetrics : readonly MetricRow[] = rowsOf("DriftLag");
export const macrotaskLagMetrics : readonly MetricRow[] = rowsOf("MacrotaskLag");
export const workerLagMetrics : readonly MetricRow[] = rowsOf("WorkerLagMonitor");
export const livenessMetrics : readonly MetricRow[] = rowsOf("SharedLivenessMonitor");
export const conditionsMetrics : readonly MetricRow[] = rowsOf("MeasurementConditions");
export const loafMetrics : readonly MetricRow[] = rowsOf("LongAnimationFrameMonitor");
export const eventTimingMetrics : readonly MetricRow[] = rowsOf("EventTimingMonitor");
export const layoutShiftMetrics : readonly MetricRow[] = rowsOf("LayoutShiftMonitor");
export const vitalsMetrics : readonly MetricRow[] = rowsOf("PageViewVitals");
export const frameTimingMetrics : readonly MetricRow[] = rowsOf("FrameTimingMonitor");
export const idleMetrics : readonly MetricRow[] = rowsOf("IdleAvailabilityMonitor");
export const schedulingMetrics : readonly MetricRow[] = rowsOf("SchedulingFairnessMonitor");
export const memoryMetrics : readonly MetricRow[] = rowsOf("MemoryMonitor");
export const pressureMetrics : readonly MetricRow[] = rowsOf("ComputePressureMonitor");
export const gcMetrics : readonly MetricRow[] = rowsOf("GCSignalDetector");
export const lifecycleMetrics : readonly MetricRow[] = rowsOf("LifecycleStateMachine");
export const throttleMetrics : readonly MetricRow[] = rowsOf("TimerThrottleDetector");
export const clockMetrics : readonly MetricRow[] = rowsOf("ClockReliabilityChecker", "ClockDriftMonitor");
export const browserReportMetrics : readonly MetricRow[] = rowsOf("BrowserReportMonitor");

/** Every metric of the catalog. */
export const allMetrics : readonly MetricRow[] = METRIC_CATALOG.map(toRow);
