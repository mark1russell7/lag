/**
 * The metrics of each monitor, for `<MetricTable>`. The names, kinds, units
 * and attributes come from `packages/lag/src/instrumented/*.ts`; the
 * descriptions come from the README. Update this file when a factory changes.
 */
import type { MetricRow } from "../../../src/components/MetricTable/types";

export const driftLagMetrics : readonly MetricRow[] = [
    { name : "lag_drift_histogram", kind : "histogram", unit : "ms", description : "How late each 100 ms window of chained 5 ms timeouts ends." },
    { name : "lag_drift_max_gauge", kind : "gauge", unit : "ms", description : "The highest drift since the previous collection." },
    { name : "lag_drift_avg_gauge", kind : "gauge", unit : "ms", description : "The average drift since the previous collection." },
];

export const macrotaskLagMetrics : readonly MetricRow[] = [
    { name : "lag_macrotask_histogram", kind : "histogram", unit : "ms", description : "How long a setTimeout(0) callback waits in the task queue. One sample every 5 s." },
    { name : "lag_macrotask_max_gauge", kind : "gauge", unit : "ms", description : "The longest wait since the previous collection." },
    { name : "lag_macrotask_avg_gauge", kind : "gauge", unit : "ms", description : "The average wait since the previous collection." },
];

export const workerLagMetrics : readonly MetricRow[] = [
    { name : "lag_worker_main_block_histogram", kind : "histogram", unit : "ms", description : "How long each heartbeat of the worker waits until the main thread handles it." },
    { name : "lag_worker_main_block_max_gauge", kind : "gauge", unit : "ms", description : "The longest wait since the previous collection." },
    { name : "lag_worker_self_lag_histogram", kind : "histogram", unit : "ms", description : "How late the timer of the worker itself runs. A high value means that the worker did not get CPU time." },
];

export const loafMetrics : readonly MetricRow[] = [
    { name : "lag_loaf_blocking_histogram", kind : "histogram", unit : "ms", description : "The blocking duration of each long animation frame." },
    { name : "lag_loaf_duration_histogram", kind : "histogram", unit : "ms", description : "The duration of each long animation frame (frames longer than 50 ms)." },
];

export const eventTimingMetrics : readonly MetricRow[] = [
    { name : "lag_inp_histogram", kind : "histogram", unit : "ms", description : "The duration of each interaction event of 16 ms or more." },
    { name : "lag_inp_input_delay_histogram", kind : "histogram", unit : "ms", description : "The input delay of each event: the time before the handlers start." },
    { name : "lag_inp_processing_histogram", kind : "histogram", unit : "ms", description : "The processing time of each event: the time in the handlers." },
    { name : "lag_inp_presentation_delay_histogram", kind : "histogram", unit : "ms", description : "The presentation delay of each event: the time until the next frame shows." },
    { name : "lag_inp_worst_gauge", kind : "gauge", unit : "ms", description : "The Interaction to Next Paint (INP) of the page." },
];

export const layoutShiftMetrics : readonly MetricRow[] = [
    { name : "lag_cls_shift_histogram", kind : "histogram", unit : "score", description : "The score of each layout shift." },
    { name : "lag_cls_worst_session_gauge", kind : "gauge", unit : "score", description : "The Cumulative Layout Shift (CLS): the score of the worst session window." },
];

export const paintMetrics : readonly MetricRow[] = [
    { name : "lag_paint_first_paint_gauge", kind : "gauge", unit : "ms", description : "First paint (FP)." },
    { name : "lag_paint_first_contentful_paint_gauge", kind : "gauge", unit : "ms", description : "First contentful paint (FCP)." },
    { name : "lag_lcp_gauge", kind : "gauge", unit : "ms", description : "Largest contentful paint (LCP)." },
];

export const frameTimingMetrics : readonly MetricRow[] = [
    { name : "lag_frame_delta_histogram", kind : "histogram", unit : "ms", description : "The time between two requestAnimationFrame callbacks." },
    { name : "lag_frame_fps_gauge", kind : "gauge", unit : "fps", description : "The frame rate since the previous collection." },
    { name : "lag_frame_dropped_rate_gauge", kind : "gauge", unit : "ratio", description : "The part of the frames that the page dropped since the previous collection. The monitor assumes 60 Hz." },
];

export const idleMetrics : readonly MetricRow[] = [
    { name : "lag_idle_time_remaining_histogram", kind : "histogram", unit : "ms", description : "The idle time that is left when an idle callback runs." },
    { name : "lag_idle_gap_histogram", kind : "histogram", unit : "ms", description : "The time between two idle callbacks." },
    { name : "lag_idle_timeout_rate_gauge", kind : "gauge", unit : "ratio", description : "The part of the idle callbacks since the previous collection that ran because of their timeout, not because the main thread was idle." },
];

export const schedulingMetrics : readonly MetricRow[] = [
    { name : "lag_scheduling_macrotask_histogram", kind : "histogram", unit : "ms", description : "The latency of a setTimeout(0) callback." },
    { name : "lag_scheduling_message_channel_histogram", kind : "histogram", unit : "ms", description : "The latency of a postMessage callback on a MessageChannel." },
    { name : "lag_scheduling_microtask_histogram", kind : "histogram", unit : "ms", description : "The latency of a queueMicrotask callback. It is a baseline of about 0." },
];

export const memoryMetrics : readonly MetricRow[] = [
    { name : "lag_memory_used_bytes_histogram", kind : "histogram", unit : "By", attributes : ["source"], description : "The memory that the page uses. The source attribute tells which API measured it." },
    { name : "lag_memory_usage_percent_gauge", kind : "gauge", unit : "%", description : "The used memory as a percentage of the limit, if the API gives a limit." },
];

export const pressureMetrics : readonly MetricRow[] = [
    { name : "lag_pressure_change_histogram", kind : "histogram", unit : "ordinal", attributes : ["source"], description : "Each change of the pressure state: 0 is nominal, 3 is critical." },
    { name : "lag_pressure_state_gauge", kind : "gauge", unit : "ordinal", description : "The worst pressure state now." },
];

export const gcMetrics : readonly MetricRow[] = [
    { name : "lag_gc_events", kind : "counter", unit : "{gc}", description : "One for each garbage collection cycle that the canary detects." },
    { name : "lag_gc_recent_rate_gauge", kind : "gauge", unit : "events", description : "The number of detected cycles in the last 60 s." },
];

export const lifecycleMetrics : readonly MetricRow[] = [
    { name : "lag_lifecycle_transitions", kind : "counter", unit : "{transition}", attributes : ["from", "to", "trigger"], description : "One for each Page Lifecycle transition." },
];

export const throttleMetrics : readonly MetricRow[] = [
    { name : "lag_timer_throttled_gauge", kind : "gauge", unit : "1", description : "1 while the browser throttles the timers, otherwise 0." },
];

export const clockMetrics : readonly MetricRow[] = [
    { name : "lag_clock_resolution_gauge", kind : "gauge", unit : "ms", description : "The resolution of performance.now()." },
];

/** Every metric of `setupAllMonitors()`. */
export const allMetrics : readonly MetricRow[] = [
    ...driftLagMetrics,
    ...macrotaskLagMetrics,
    ...workerLagMetrics,
    ...loafMetrics,
    ...eventTimingMetrics,
    ...layoutShiftMetrics,
    ...paintMetrics,
    ...frameTimingMetrics,
    ...idleMetrics,
    ...schedulingMetrics,
    ...memoryMetrics,
    ...pressureMetrics,
    ...gcMetrics,
    ...lifecycleMetrics,
    ...throttleMetrics,
    ...clockMetrics,
];
