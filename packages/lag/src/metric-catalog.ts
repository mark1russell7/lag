/**
 * The catalog of all metrics and events that the instrumented factories
 * emit. The factories create their instruments from these definitions, and
 * the documentation shows them. A test makes sure that the two agree.
 *
 * Rules for every metric:
 * - The kind is a counter or a histogram, so that values from many browsers
 *   aggregate correctly.
 * - Attributes have a small, fixed set of values. Measured values,
 *   timestamps and IDs are never attributes.
 */

import type { Attributes, Counter, Histogram, Meter } from "./meter.js";

export type MetricKind = "histogram" | "counter";

export type MetricDefinition = {
    name : string;
    kind : MetricKind;
    unit : string;
    /** The monitor that emits the metric. */
    monitor : string;
    description : string;
    /** Attribute name to its permitted values. */
    attributes : Readonly<Record<string, readonly string[]>>;
};

export type MetricKey =
    | "drift" | "macrotask"
    | "samplesDiscarded" | "stalls" | "stallDuration"
    | "workerMainBlock" | "workerSelfLag" | "workerClockOffset" | "hangs" | "hangDuration"
    | "loafBlocking" | "loafDuration"
    | "eventDuration" | "eventInputDelay" | "eventProcessing" | "eventPresentationDelay"
    | "layoutShift"
    | "vitalInp" | "vitalCls" | "vitalLcp" | "vitalFcp" | "vitalTtfb"
    | "frameDelta" | "frames"
    | "idleTimeRemaining" | "idleGap" | "idleCallbacks"
    | "schedulingMicrotask" | "schedulingMacrotask" | "schedulingMessageChannel"
    | "memoryUsed" | "memoryUsage"
    | "pressureState"
    | "gcEvents"
    | "lifecycleTransitions"
    | "timerCalibrations"
    | "clockResolution" | "clockSkew" | "clockJumps"
    | "browserReports"
    | "livenessBlock";

const LIFECYCLE_STATES = ["active", "passive", "hidden", "frozen", "terminated"] as const;
const NAVIGATION_TYPES = ["navigate", "reload", "back_forward", "back_forward_cache", "prerender", "restore", "soft"] as const;
const INTERACTION_TYPES = ["pointer", "keyboard", "other"] as const;
const PRESSURE_SOURCES = ["cpu", "thermals", "power", "memory"] as const;

function metric(
    name : string,
    kind : MetricKind,
    unit : string,
    monitor : string,
    description : string,
    attributes : Readonly<Record<string, readonly string[]>> = {},
) : MetricDefinition {
    return { name, kind, unit, monitor, description, attributes };
}

export const METRICS : Readonly<Record<MetricKey, MetricDefinition>> = {
    drift : metric("lag_drift_histogram", "histogram", "ms", "DriftLag",
        "The lag of one 100 ms window of chained 5 ms timeouts. Each block of the main thread in the window adds to the lag."),
    macrotask : metric("lag_macrotask_histogram", "histogram", "ms", "MacrotaskLag",
        "The time that a zero-delay timeout waits in the task queue. The monitor measures one sample every 5 seconds."),

    samplesDiscarded : metric("lag_samples_discarded", "counter", "{sample}", "MeasurementConditions",
        "The number of samples that a monitor did not record because the measurement window was not valid.",
        { reason : ["hidden", "frozen", "suspend"] }),
    stalls : metric("lag_stalls", "counter", "{stall}", "MeasurementConditions",
        "The number of very long samples. A hang has no evidence of a suspend. A suspend overlaps evidence that the system stopped.",
        { kind : ["hang", "suspend"] }),
    stallDuration : metric("lag_stall_duration_histogram", "histogram", "ms", "MeasurementConditions",
        "The duration of each very long sample.",
        { kind : ["hang", "suspend"] }),

    workerMainBlock : metric("lag_worker_main_block_histogram", "histogram", "ms", "WorkerLagMonitor",
        "The time that a worker heartbeat waited for the main thread. This is main-thread blocking, measured from outside the main thread."),
    workerSelfLag : metric("lag_worker_self_lag_histogram", "histogram", "ms", "WorkerLagMonitor",
        "The lateness of the worker's own heartbeat timer. A high value shows that the worker itself did not run."),
    workerClockOffset : metric("lag_worker_clock_offset_histogram", "histogram", "ms", "WorkerLagMonitor",
        "The absolute offset between the worker clock and the main-thread clock, from the clock synchronization exchange."),
    hangs : metric("lag_main_thread_hangs", "counter", "{hang}", "WorkerLagMonitor",
        "The number of main-thread hangs that the worker detected. In a hang, the main thread does not acknowledge heartbeats."),
    hangDuration : metric("lag_main_thread_hang_duration_histogram", "histogram", "ms", "WorkerLagMonitor",
        "The duration of each main-thread hang that ended."),

    loafBlocking : metric("lag_loaf_blocking_histogram", "histogram", "ms", "LongAnimationFrameMonitor",
        "The blocking duration of each long animation frame."),
    loafDuration : metric("lag_loaf_duration_histogram", "histogram", "ms", "LongAnimationFrameMonitor",
        "The total duration of each long animation frame."),

    eventDuration : metric("lag_event_duration_histogram", "histogram", "ms", "EventTimingMonitor",
        "The duration of each interaction event of 16 ms or more, from input to the next paint.",
        { interaction : INTERACTION_TYPES }),
    eventInputDelay : metric("lag_event_input_delay_histogram", "histogram", "ms", "EventTimingMonitor",
        "The time from the input to the start of the event handlers.",
        { interaction : INTERACTION_TYPES }),
    eventProcessing : metric("lag_event_processing_histogram", "histogram", "ms", "EventTimingMonitor",
        "The time that the event handlers ran.",
        { interaction : INTERACTION_TYPES }),
    eventPresentationDelay : metric("lag_event_presentation_delay_histogram", "histogram", "ms", "EventTimingMonitor",
        "The time from the end of the event handlers to the next paint.",
        { interaction : INTERACTION_TYPES }),

    layoutShift : metric("lag_layout_shift_histogram", "histogram", "1", "LayoutShiftMonitor",
        "The score of each layout shift that did not follow user input."),

    vitalInp : metric("lag_web_vital_inp_histogram", "histogram", "ms", "PageViewVitals",
        "Interaction to Next Paint (INP) for each page view.",
        { navigation_type : NAVIGATION_TYPES }),
    vitalCls : metric("lag_web_vital_cls_histogram", "histogram", "1", "PageViewVitals",
        "Cumulative Layout Shift (CLS) for each page view.",
        { navigation_type : NAVIGATION_TYPES }),
    vitalLcp : metric("lag_web_vital_lcp_histogram", "histogram", "ms", "PageViewVitals",
        "Largest Contentful Paint (LCP) for each page view.",
        { navigation_type : NAVIGATION_TYPES }),
    vitalFcp : metric("lag_web_vital_fcp_histogram", "histogram", "ms", "PageViewVitals",
        "First Contentful Paint (FCP) for each page view.",
        { navigation_type : NAVIGATION_TYPES }),
    vitalTtfb : metric("lag_web_vital_ttfb_histogram", "histogram", "ms", "PageViewVitals",
        "Time to First Byte (TTFB) for each page view that has a network response.",
        { navigation_type : NAVIGATION_TYPES }),

    frameDelta : metric("lag_frame_delta_histogram", "histogram", "ms", "FrameTimingMonitor",
        "The time between two animation frame callbacks."),
    frames : metric("lag_frames", "counter", "{frame}", "FrameTimingMonitor",
        "The number of delivered frames and the estimated number of dropped frames.",
        { outcome : ["delivered", "dropped"] }),

    idleTimeRemaining : metric("lag_idle_time_remaining_histogram", "histogram", "ms", "IdleAvailabilityMonitor",
        "The idle time that was available when an idle callback ran."),
    idleGap : metric("lag_idle_gap_histogram", "histogram", "ms", "IdleAvailabilityMonitor",
        "The time between two idle callbacks."),
    idleCallbacks : metric("lag_idle_callbacks", "counter", "{callback}", "IdleAvailabilityMonitor",
        "The number of idle callbacks. A callback that timed out ran because no idle period came in time.",
        { timed_out : ["true", "false"] }),

    schedulingMicrotask : metric("lag_scheduling_microtask_histogram", "histogram", "ms", "SchedulingFairnessMonitor",
        "The latency of a queueMicrotask callback. This value stays near 0 and is a baseline."),
    schedulingMacrotask : metric("lag_scheduling_macrotask_histogram", "histogram", "ms", "SchedulingFairnessMonitor",
        "The latency of a zero-delay timeout."),
    schedulingMessageChannel : metric("lag_scheduling_message_channel_histogram", "histogram", "ms", "SchedulingFairnessMonitor",
        "The latency of a MessageChannel message."),

    memoryUsed : metric("lag_memory_used_bytes_histogram", "histogram", "By", "MemoryMonitor",
        "The used heap memory of each sample.",
        { source : ["modern", "legacy"] }),
    memoryUsage : metric("lag_memory_usage_ratio_histogram", "histogram", "1", "MemoryMonitor",
        "The used heap divided by the heap limit. Only the legacy source supplies the limit."),

    pressureState : metric("lag_pressure_state_histogram", "histogram", "1", "ComputePressureMonitor",
        "The compute pressure state of each record: 0 nominal, 1 fair, 2 serious, 3 critical.",
        { source : PRESSURE_SOURCES }),

    gcEvents : metric("lag_gc_events", "counter", "{gc}", "GCSignalDetector",
        "The number of garbage collections that the detector saw."),

    lifecycleTransitions : metric("lag_lifecycle_transitions", "counter", "{transition}", "LifecycleStateMachine",
        "The number of page lifecycle transitions.",
        {
            from : LIFECYCLE_STATES,
            to : LIFECYCLE_STATES,
            trigger : ["focus", "blur", "visibilitychange", "freeze", "resume", "pagehide", "pageshow"],
        }),

    timerCalibrations : metric("lag_timer_calibrations", "counter", "{calibration}", "TimerThrottleDetector",
        "The number of timer calibration rounds. A throttled round shows that the browser slowed the timers.",
        { throttled : ["true", "false"] }),

    clockResolution : metric("lag_clock_resolution_histogram", "histogram", "ms", "ClockReliabilityChecker",
        "The resolution of performance.now(). The checker measures it one time for each page."),
    clockSkew : metric("lag_clock_skew_histogram", "histogram", "ms", "ClockDriftMonitor",
        "The absolute difference between Date.now() and performance.timeOrigin + performance.now()."),
    clockJumps : metric("lag_clock_jumps", "counter", "{jump}", "ClockDriftMonitor",
        "The number of sudden changes of the difference between the wall clock and the monotonic clock.",
        { direction : ["forward", "backward"] }),

    browserReports : metric("lag_browser_reports", "counter", "{report}", "BrowserReportMonitor",
        "The number of reports from the Reporting API, for example interventions and deprecations.",
        { type : ["intervention", "deprecation"] }),

    livenessBlock : metric("lag_liveness_block_histogram", "histogram", "ms", "SharedLivenessMonitor",
        "The duration of each main-thread block that a worker saw through shared memory."),
};

export const METRIC_CATALOG : readonly MetricDefinition[] = Object.values(METRICS);

export type EventDefinition = {
    name : string;
    /** The monitor that emits the event. */
    monitor : string;
    description : string;
    /** The attribute names of the event. */
    attributes : readonly string[];
};

export type EventKey = "webVital" | "hang" | "clockJump" | "longAnimationFrame" | "browserReport" | "stall";

/**
 * Events carry the details that metrics must not carry: IDs, URLs, CSS
 * selectors and script names. The `browser.web_vital` event follows the
 * OpenTelemetry semantic conventions for browsers.
 */
export const EVENTS : Readonly<Record<EventKey, EventDefinition>> = {
    webVital : {
        name : "browser.web_vital",
        monitor : "PageViewVitals",
        description : "The final value of one Core Web Vital for one page view, with attribution.",
        attributes : ["name", "value", "delta", "id", "rating", "navigation_type", "attribution"],
    },
    hang : {
        name : "lag.main_thread.hang",
        monitor : "WorkerLagMonitor",
        description : "A main-thread hang that the worker detected. The worker sends the start itself, because the main thread cannot.",
        attributes : ["phase", "duration_ms"],
    },
    clockJump : {
        name : "lag.clock.jump",
        monitor : "ClockDriftMonitor",
        description : "A sudden change of the difference between the wall clock and the monotonic clock, for example after the device slept.",
        attributes : ["direction", "magnitude_ms", "skew_ms"],
    },
    longAnimationFrame : {
        name : "lag.long_animation_frame",
        monitor : "LongAnimationFrameMonitor",
        description : "A long animation frame above the attribution threshold, with the script that blocked it most.",
        attributes : ["duration_ms", "blocking_duration_ms", "script.invoker", "script.invoker_type", "script.source_url", "script.duration_ms"],
    },
    browserReport : {
        name : "lag.browser_report",
        monitor : "BrowserReportMonitor",
        description : "One report from the Reporting API.",
        attributes : ["type", "id", "message", "source_file", "line_number"],
    },
    stall : {
        name : "lag.stall",
        monitor : "MeasurementConditions",
        description : "A very long sample and its classification as a hang or a suspend.",
        attributes : ["kind", "duration_ms"],
    },
};

export const EVENT_CATALOG : readonly EventDefinition[] = Object.values(EVENTS);

function assertKind(definition : MetricDefinition, kind : MetricKind) : void {
    if (definition.kind !== kind) {
        throw new Error(`${definition.name} is a ${definition.kind}, not a ${kind}.`);
    }
}

/** Creates the histogram that `definition` describes. */
export function createHistogram<A extends Attributes = Attributes>(meter : Meter, definition : MetricDefinition) : Histogram<A> {
    assertKind(definition, "histogram");
    return meter.createHistogram<A>(definition.name, { unit : definition.unit, description : definition.description });
}

/** Creates the counter that `definition` describes. */
export function createCounter<A extends Attributes = Attributes>(meter : Meter, definition : MetricDefinition) : Counter<A> {
    assertKind(definition, "counter");
    return meter.createCounter<A>(definition.name, { unit : definition.unit, description : definition.description });
}
