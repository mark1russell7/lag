import { METRIC_DEFINITIONS, type DemoFocus, type MetricKey } from "../adapters/lag-core";
import type { LoadActionId, ProfileId } from "../adapters/lag-load";
import type { SessionKind } from "./session";

/**
 * The live demos of the documentation. Each demo starts one monitor in the
 * page of the monitor (refer to `DemoFocus`), with the load that makes its
 * signal. The component is `components/LiveDemo`.
 */

/** The chart of a demo: the values of one metric in the last 30 s. */
export type DemoChart = {
    metric : MetricKey;
    title : string;
    /** What the chart shows. It is the text alternative of the chart. */
    description : string;
    /** "line" for regular samples, "dot" for separate events, "count" for a counter (its total since the start). */
    mark : "line" | "dot" | "count";
    reference? : { value : number; label : string };
    emptyText : string;
};

/** One value under the chart. */
export type DemoValue = {
    metric : MetricKey;
    label : string;
    /**
     * - `latest`: the newest value.
     * - `count`: the number of values since the start.
     * - `total`: the sum of the values since the start (for a counter, its value).
     * - `max`: the maximum value in the last 30 s.
     */
    show : "latest" | "count" | "total" | "max";
    /** Only the values with this attribute value, for example `outcome=dropped`. Only for `total`. */
    attribute? : string;
    /** `percent`: a ratio from 0 to 1 shows as a percentage. */
    format? : "percent";
};

/**
 * A load button of a demo:
 * - `action`: a load action of the playground.
 * - `profile`: a workload profile of the playground, for some seconds.
 * - `shift`: the demo moves its own content 1 s after the click, so that the shift has no recent input.
 */
export type DemoLoad =
    | { kind : "action"; id : LoadActionId }
    | { kind : "profile"; id : ProfileId; durationMs : number; label : string }
    | { kind : "shift" };

export type DemoInfo = {
    focus : DemoFocus;
    /** The monitor class, for the heading. */
    monitor : string;
    /** The name of the API on the browser support page, if the monitor needs one. */
    feature? : string;
    /** The chart, if a chart can show the signal. */
    chart? : DemoChart;
    values : readonly DemoValue[];
    loads : readonly DemoLoad[];
    /** What the reader does, and what the demo then shows. */
    instructions : string;
};

export const DEMOS : Readonly<Record<DemoFocus, DemoInfo>> = {
    "drift-lag" : {
        focus : "drift-lag",
        monitor : "DriftLag",
        chart : {
            metric : "drift",
            title : "The lag of each window of DriftLag",
            description : "One value for each window of approximately 100 ms: the duration of the window minus the idle duration of its steps.",
            mark : "line",
            reference : { value : 50, label : "Long task: 50 ms" },
            emptyText : "No windows yet. DriftLag reports one value for each window of approximately 100 ms.",
        },
        values : [
            { metric : "drift", label : "Windows", show : "count" },
            { metric : "drift", label : "Blocked time (sum)", show : "total" },
            { metric : "driftBaseline", label : "Baseline step", show : "latest" },
        ],
        loads : [{ kind : "action", id : "block-50" }, { kind : "action", id : "block-200" }],
        instructions : "Select a block button. The window that contains the block gets a lag near the duration of the block. The sum of the lag is the blocked time.",
    },
    "macrotask-lag" : {
        focus : "macrotask-lag",
        monitor : "MacrotaskLag",
        chart : {
            metric : "macrotask",
            title : "The wait of a zero-delay timeout",
            description : "One value each 5 s: the time that a zero-delay timeout waited in the task queue.",
            mark : "dot",
            emptyText : "No samples yet. The monitor takes one sample each 5 s.",
        },
        values : [
            { metric : "macrotask", label : "Samples", show : "count" },
            { metric : "macrotask", label : "Latest", show : "latest" },
            { metric : "macrotask", label : "Maximum", show : "max" },
        ],
        loads : [{ kind : "profile", id : "heavy", durationMs : 15_000, label : "Heavy load for 15 s" }],
        instructions : "Start the heavy load. The monitor takes one sample each 5 s, thus the load gives approximately 3 samples. A sample is high when the timeout waits behind the tasks of the load.",
    },
    "long-animation-frames" : {
        focus : "long-animation-frames",
        monitor : "LongAnimationFrameMonitor",
        feature : "Long Animation Frames",
        chart : {
            metric : "loafBlocking",
            title : "The blocking duration of each long animation frame",
            description : "One dot for each frame of 50 ms or more: the time in its long tasks above 50 ms each.",
            mark : "dot",
            emptyText : "No long frames yet. Select a load button.",
        },
        values : [
            { metric : "loafBlocking", label : "Long frames", show : "count" },
            { metric : "loafDuration", label : "Last frame duration", show : "latest" },
            { metric : "loafBlocking", label : "Maximum blocking", show : "max" },
        ],
        loads : [{ kind : "action", id : "long-animation-frame" }, { kind : "action", id : "block-200" }],
        instructions : "Select a load button. The browser reports a long animation frame after the next paint.",
    },
    "event-timing" : {
        focus : "event-timing",
        monitor : "EventTimingMonitor",
        feature : "Event Timing",
        chart : {
            metric : "eventDuration",
            title : "The duration of each interaction event",
            description : "One dot for each event of 16 ms or more: the time from the input to the next paint.",
            mark : "dot",
            reference : { value : 200, label : "Good INP: 200 ms or less" },
            emptyText : "No events yet. Select a block button: the click itself is the interaction.",
        },
        values : [
            { metric : "eventInputDelay", label : "Input delay", show : "latest" },
            { metric : "eventProcessing", label : "Processing", show : "latest" },
            { metric : "eventPresentationDelay", label : "Presentation delay", show : "latest" },
        ],
        loads : [{ kind : "action", id : "block-200" }, { kind : "action", id : "block-800" }],
        instructions : "Select a block button. The handler of the click blocks the main thread, thus the processing duration of the click is the duration of the block.",
    },
    "frame-timing" : {
        focus : "frame-timing",
        monitor : "FrameTimingMonitor",
        chart : {
            metric : "frameDelta",
            title : "The time between two animation frames",
            description : "The time between the frame timestamps of two animation frame callbacks. At 60 Hz, a frame takes 16.7 ms.",
            mark : "line",
            reference : { value : 16.7, label : "One frame at 60 Hz" },
            emptyText : "No frames yet. The browser does not run animation frames while the tab is hidden.",
        },
        values : [
            { metric : "frames", label : "Delivered frames", show : "total", attribute : "outcome=delivered" },
            { metric : "frames", label : "Dropped frames", show : "total", attribute : "outcome=dropped" },
            { metric : "frameDelta", label : "Longest gap", show : "max" },
        ],
        loads : [{ kind : "action", id : "block-200" }, { kind : "action", id : "layout-thrash" }],
        instructions : "Select a load button. A block of 200 ms makes one gap of 200 ms, which counts as approximately 11 dropped frames at 60 Hz.",
    },
    "worker-lag" : {
        focus : "worker-lag",
        monitor : "WorkerLagMonitor",
        chart : {
            metric : "workerMainBlock",
            title : "The wait of each worker heartbeat",
            description : "The time that each heartbeat of the worker waited for the main thread. The demo sends one heartbeat each 100 ms.",
            mark : "line",
            emptyText : "No heartbeats yet. The browser did not start the worker, or the first heartbeats did not arrive.",
        },
        values : [
            { metric : "workerMainBlock", label : "Heartbeats", show : "count" },
            { metric : "workerMainBlock", label : "Longest wait", show : "max" },
            { metric : "workerSelfLag", label : "Worker timer lateness", show : "latest" },
        ],
        loads : [{ kind : "action", id : "block-200" }, { kind : "action", id : "block-800" }],
        instructions : "Select a block button. The heartbeats that arrive during the block wait until its end. Their waits go down from the duration of the block to 0, one step for each heartbeat.",
    },
    "layout-shift" : {
        focus : "layout-shift",
        monitor : "LayoutShiftMonitor",
        feature : "Layout Instability",
        chart : {
            metric : "layoutShift",
            title : "The score of each layout shift",
            description : "One dot for each layout shift that did not follow user input.",
            mark : "dot",
            emptyText : "No layout shifts yet. Select the button, and wait 1 s.",
        },
        values : [
            { metric : "layoutShift", label : "Shifts", show : "count" },
            { metric : "layoutShift", label : "Sum of the scores", show : "total" },
            { metric : "layoutShift", label : "Latest score", show : "latest" },
        ],
        loads : [{ kind : "shift" }],
        instructions : "Select the button. 1 s later, the demo adds a box above its chart, and the chart moves down. A shift in the 500 ms after an input does not count, thus the demo waits.",
    },
    "gc-signal" : {
        focus : "gc-signal",
        monitor : "GCSignalDetector",
        feature : "Weak references",
        chart : {
            metric : "gcEvents",
            title : "The garbage collections that the detector saw",
            description : "The number of garbage collections since the start of the demo.",
            mark : "count",
            emptyText : "No garbage collections yet. Select the button to make garbage.",
        },
        values : [{ metric : "gcEvents", label : "Garbage collections", show : "total" }],
        loads : [{ kind : "action", id : "gc-pressure" }],
        instructions : "Select the button. It makes many short-lived objects for 300 ms. The engine collects them later, and the detector counts each collection that it sees.",
    },
    "idle-availability" : {
        focus : "idle-availability",
        monitor : "IdleAvailabilityMonitor",
        feature : "Idle callbacks",
        chart : {
            metric : "idleTimeRemaining",
            title : "The idle time at the start of each idle callback",
            description : "The idle time that was available when each idle callback started. The maximum is 50 ms.",
            mark : "line",
            reference : { value : 50, label : "Longest idle period: 50 ms" },
            emptyText : "No idle callbacks yet.",
        },
        values : [
            { metric : "idleGap", label : "Longest gap", show : "max" },
            { metric : "idleCallbacks", label : "Callbacks that timed out", show : "total", attribute : "timed_out=true" },
            { metric : "idleCallbacks", label : "Callbacks", show : "total" },
        ],
        loads : [{ kind : "action", id : "block-200" }, { kind : "profile", id : "moderate", durationMs : 10_000, label : "Moderate load for 10 s" }],
        instructions : "Select a load button. While the main thread is busy, the idle time goes down and the gaps between the idle callbacks become longer.",
    },
    "lifecycle" : {
        focus : "lifecycle",
        monitor : "LifecycleStateMachine",
        values : [{ metric : "lifecycleTransitions", label : "Transitions", show : "total" }],
        loads : [],
        instructions : "Select another window, or another tab, and then come back. Each change of the focus or the visibility is a transition.",
    },
    "memory" : {
        focus : "memory",
        monitor : "MemoryMonitor",
        feature : "Legacy memory API",
        chart : {
            metric : "memoryUsed",
            title : "The used heap memory",
            description : "The used heap memory of the page. The demo takes one sample each 2 s.",
            mark : "line",
            emptyText : "No samples yet. The demo takes one sample each 2 s.",
        },
        values : [
            { metric : "memoryUsed", label : "Latest", show : "latest" },
            { metric : "memoryUsed", label : "Maximum", show : "max" },
            { metric : "memoryUsage", label : "Part of the heap limit", show : "latest", format : "percent" },
        ],
        loads : [{ kind : "action", id : "gc-pressure" }],
        instructions : "Select the button. It makes many short-lived objects. The used memory increases, and then it goes down after a garbage collection.",
    },
};

/** The demo of a session kind, or `undefined` if the kind is not a demo. */
export function demoFocusOf(kind : SessionKind) : DemoFocus | undefined {
    if (!kind.startsWith("demo:")) return undefined;
    const focus = kind.slice("demo:".length);
    return Object.hasOwn(DEMOS, focus) ? focus as DemoFocus : undefined;
}

/** The names of the instruments that a demo shows. */
export function demoMetricNames(focus : DemoFocus) : string[] {
    const demo = DEMOS[focus];
    const keys = [...(demo.chart ? [demo.chart.metric] : []), ...demo.values.map(value => value.metric)];
    return [...new Set(keys.map(key => METRIC_DEFINITIONS[key].name))];
}
