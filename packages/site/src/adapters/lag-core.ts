/**
 * The only module of the site that uses `@mark1russell7/lag` and its export
 * `@mark1russell7/lag/worker`. The site imports the source of the package in
 * this repository (refer to the aliases in `vite.config.ts`), not the release
 * on npm.
 *
 * When the API of the package changes, update this file and nothing else. The
 * site uses `setupAllMonitors`, `createBrowserDeps`, the metric catalog, the
 * `Meter` type and the event and span ports. It also uses three observer
 * monitors for the timeline of the playground, and `createLagWorker`.
 */
import {
    METRICS as CATALOG,
    METRIC_CATALOG,
    EVENT_CATALOG,
    SPAN_CATALOG,
    EVENTS,
    SPANS,
    VITAL_THRESHOLDS,
    EventTimingMonitor,
    HISTOGRAM_BOUNDARIES,
    LayoutShiftMonitor,
    LongAnimationFrameMonitor,
    createBrowserDeps,
    interactionType,
    rateVital,
    setupAllMonitors,
    type AllMonitorDeps,
    type EventSink,
    type Logger,
    type Meter,
    type MetricKey,
    type PerformanceObserverInit,
    type Rating,
    type SpanSink,
} from "@mark1russell7/lag";
import { createLagWorker } from "@mark1russell7/lag/worker";

export type { MetricKey };

export type {
    Attributes,
    AttributeValue,
    Counter,
    EventAttributes,
    EventDefinition,
    EventOptions,
    EventSink,
    Histogram,
    Meter,
    MetricDefinition,
    OpenSpan,
    Rating,
    SpanDefinition,
    SpanIdentity,
    SpanOptions,
    SpanSink,
} from "@mark1russell7/lag";

/** Every metric, event and span that the monitors emit: the single source for the documentation. */
export { METRIC_CATALOG, EVENT_CATALOG, SPAN_CATALOG };

/** Each metric of the catalog by its key, for example `METRIC_DEFINITIONS.drift`. */
export const METRIC_DEFINITIONS = CATALOG;

/** The bucket boundaries of the histograms of the catalog (the `advice` to the SDK). */
export { HISTOGRAM_BOUNDARIES };

type LagWorker = ReturnType<typeof createLagWorker>;

/** The names of the instruments that the site reads from its meter. */
export const METRICS = {
    driftLag : CATALOG.drift.name,
    macrotaskLag : CATALOG.macrotask.name,
    workerMainBlock : CATALOG.workerMainBlock.name,
    frameDelta : CATALOG.frameDelta.name,
    eventDuration : CATALOG.eventDuration.name,
    gcEvents : CATALOG.gcEvents.name,
    lifecycleTransitions : CATALOG.lifecycleTransitions.name,
} as const;

/** The instruments that the session reads. A test runtime can give other names. */
export type MetricNames = { readonly [K in keyof typeof METRICS] : string };

/** The names of the events and the spans that the timeline of the playground reads. */
export const TIMELINE_NAMES = {
    pageView : SPANS.pageView.name,
    hang : SPANS.hang.name,
    stall : SPANS.stall.name,
    longAnimationFrame : SPANS.longAnimationFrame.name,
    hidden : SPANS.hidden.name,
    frozen : SPANS.frozen.name,
    lifecycleTransition : EVENTS.lifecycleTransition.name,
    pressureChange : EVENTS.pressureChange.name,
} as const;

/** The event and span names of the timeline. A test runtime can give other names. */
export type TimelineNames = { readonly [K in keyof typeof TIMELINE_NAMES] : string };

/** The INP thresholds of web-vitals, in ms: at or below `good` is good, above `poor` is poor. */
export const INP_THRESHOLDS : { readonly good : number; readonly poor : number } = VITAL_THRESHOLDS.INP;

/**
 * The monitor of a live demo in the documentation. Each value is the path of
 * the page of the monitor, below `/docs/monitors/`.
 */
export type DemoFocus =
    | "drift-lag"
    | "macrotask-lag"
    | "long-animation-frames"
    | "event-timing"
    | "frame-timing"
    | "worker-lag"
    | "layout-shift"
    | "gc-signal"
    | "idle-availability"
    | "lifecycle"
    | "memory";

/** The optional browser APIs of a demo. */
type DemoApi = "observers" | "frames" | "idle" | "memory" | "gc" | "worker";

/**
 * The optional APIs that each demo gives to `setupAllMonitors`. The setup
 * starts only the monitors whose APIs it gets. It always starts the
 * lifecycle, the measurement conditions, DriftLag, MacrotaskLag, the
 * timer-throttle detector and the clock-reliability checker. With the
 * observers, it also starts the page-view vitals, the event-timing monitor
 * and the layout-shift monitor.
 */
const DEMO_APIS : Readonly<Record<DemoFocus, readonly DemoApi[]>> = {
    "drift-lag" : [],
    "macrotask-lag" : [],
    "lifecycle" : [],
    "long-animation-frames" : ["observers"],
    "event-timing" : ["observers"],
    "layout-shift" : ["observers"],
    "frame-timing" : ["frames"],
    "idle-availability" : ["idle"],
    "memory" : ["memory"],
    "gc-signal" : ["gc"],
    "worker-lag" : ["worker"],
};

/** The entry type that each observer demo needs. */
const DEMO_ENTRY_TYPES : Partial<Readonly<Record<DemoFocus, string>>> = {
    "long-animation-frames" : "long-animation-frame",
    "event-timing" : "event",
    "layout-shift" : "layout-shift",
};

type OptionalDepKey = keyof AllMonitorDeps;

/** The keys of the dependencies that start the optional monitors of each API. */
const API_KEYS : Readonly<Record<Exclude<DemoApi, "worker">, readonly OptionalDepKey[]>> = {
    observers : ["PerformanceObserver"],
    frames : ["requestAnimationFrame", "cancelAnimationFrame"],
    idle : ["requestIdleCallback", "cancelIdleCallback"],
    memory : ["memorySource"],
    gc : ["FinalizationRegistry"],
};

/** The keys of the monitors that no demo starts: scheduling fairness, browser reports, compute pressure, shared memory and clock drift. */
const NO_DEMO_KEYS : readonly OptionalDepKey[] = [
    "MessageChannel", "queueMicrotask", "ReportingObserver", "PressureObserver", "pressureSources", "SharedArrayBuffer", "wallClock",
];

/** A demo of the memory monitor needs more than one sample each minute. */
const DEMO_MEMORY_INTERVAL_MS = 2_000;

/** The globals that `demoSupported` examines. In a page, `window` has them. */
export type DemoGlobals = {
    readonly PerformanceObserver? : unknown;
    readonly requestAnimationFrame? : unknown;
    readonly requestIdleCallback? : unknown;
    readonly FinalizationRegistry? : unknown;
    readonly Worker? : unknown;
    readonly performance? : unknown;
};

function hasApi(api : DemoApi, focus : DemoFocus, globals : DemoGlobals) : boolean {
    switch (api) {
        case "observers": {
            const types = (globals.PerformanceObserver as { supportedEntryTypes? : readonly string[] } | undefined)?.supportedEntryTypes;
            const type = DEMO_ENTRY_TYPES[focus];
            return Array.isArray(types) && (type === undefined || types.includes(type));
        }
        case "frames": return typeof globals.requestAnimationFrame === "function";
        case "idle": return typeof globals.requestIdleCallback === "function";
        case "gc": return typeof globals.FinalizationRegistry === "function";
        case "worker": return typeof globals.Worker === "function";
        case "memory": {
            const performance = globals.performance as { memory? : unknown; measureUserAgentSpecificMemory? : unknown } | undefined;
            return (typeof performance?.memory === "object" && performance.memory !== null)
                || typeof performance?.measureUserAgentSpecificMemory === "function";
        }
    }
}

/** True if this browser has all the APIs of the demo, with the same rules as `createBrowserDeps`. */
export function demoSupported(focus : DemoFocus, globals : DemoGlobals = globalThis) : boolean {
    return DEMO_APIS[focus].every(api => hasApi(api, focus, globals));
}

export type MonitorLogEntry = {
    level : string;
    message : string;
};

/** One long animation frame. The times are `performance.now()` times, in ms. */
export type RecordedFrame = {
    startTime : number;
    duration : number;
    blockingDuration : number;
    /** The time from the start of the rendering phase to the end of the frame, or 0. */
    renderDuration : number;
    /** The script that blocked the frame most, if the browser names one. */
    script? : { invoker : string; invokerType : string; duration : number };
};

export type InteractionType = "pointer" | "keyboard" | "other";

/** One Event Timing entry of a user interaction. The times are `performance.now()` times, in ms. */
export type RecordedInteractionEvent = {
    interactionId : number;
    /** The event type, for example "click" or "keydown". */
    name : string;
    type : InteractionType;
    startTime : number;
    duration : number;
    inputDelay : number;
    processingDuration : number;
    presentationDelay : number;
};

/** One layout shift without recent input. The time is a `performance.now()` time, in ms. */
export type RecordedLayoutShift = {
    startTime : number;
    value : number;
};

/**
 * The receiver of what the monitors emit, for the timeline of the
 * playground. The monitors send their events and spans to `events` and
 * `spans`. The metrics give no start time for a frame or an interaction.
 * Thus three observer monitors of the core (the same classes as the
 * monitors) also send each entry, with its start time.
 */
export type MonitorRecorder = {
    readonly events : EventSink;
    readonly spans : SpanSink;
    longAnimationFrame(frame : RecordedFrame) : void;
    interaction(event : RecordedInteractionEvent) : void;
    layoutShift(shift : RecordedLayoutShift) : void;
};

export type VitalName = "INP" | "CLS" | "LCP" | "FCP" | "TTFB";

/** The current value of one Web Vital of the current page view. */
export type VitalReading = {
    name : VitalName;
    value : number;
    /** The `performance.now()` time of the occurrence that gave the value, if the vital has one. */
    time : number | undefined;
    /** The rating of the value, with the thresholds of web-vitals. */
    rating : Rating;
};

/** The entry types that the browser can observe for the timeline. */
export type EntrySupport = {
    longAnimationFrame : boolean;
    eventTiming : boolean;
    layoutShift : boolean;
};

export type StartedMonitors = {
    /** What `setupAllMonitors` gives. `stop()` releases every timer, listener and observer. */
    readonly handles : { stop() : void };
    /** The worker of the worker-lag monitor, if the browser can start one. The caller must stop it (`terminate()`). */
    readonly worker : { terminate() : void } | undefined;
    /** The Page Lifecycle state at this time, for example "active". */
    lifecycleState() : string | undefined;
    /** The current Web Vitals of the current page view. A runtime without the vitals gives none. */
    vitals?() : readonly VitalReading[];
    /** The entry types that the browser can observe. */
    readonly support? : EntrySupport;
};

export type StartMonitorsOptions = {
    meter : Meter;
    onLog? : (entry : MonitorLogEntry) => void;
    /** The monitor of a live demo. Without it, each monitor that the browser supports starts, with a worker. */
    focus? : DemoFocus;
    /** The receiver of the events, the spans and the entries, for the timeline. */
    recorder? : MonitorRecorder;
};

/** The playground needs more than one heartbeat each second (the default) to draw a line. */
const PLAYGROUND_HEARTBEAT_MS = 100;

const NO_SUPPORT : EntrySupport = { longAnimationFrame : false, eventTiming : false, layoutShift : false };

function tryCreateWorker() : LagWorker | undefined {
    if (typeof Worker === "undefined") return undefined;
    try {
        return createLagWorker();
    } catch {
        return undefined;
    }
}

function logger(onLog : StartMonitorsOptions["onLog"]) : AllMonitorDeps["logger"] {
    return {
        log(level, message) {
            onLog?.({ level, message });
        },
    };
}

/** The monitors log their own warnings. Thus the entry probes of the timeline log nothing. */
const silentLogger : Logger = { log() {} };

function entrySupport(PerformanceObserver : PerformanceObserverInit | undefined) : EntrySupport {
    const types = PerformanceObserver?.supportedEntryTypes;
    if (!types) return NO_SUPPORT;
    return {
        longAnimationFrame : types.includes("long-animation-frame"),
        eventTiming : types.includes("event"),
        layoutShift : types.includes("layout-shift"),
    };
}

/**
 * This function starts the entry probes of the timeline: the observer
 * monitors of the core, with a report that goes to the recorder. Each
 * probe that the browser does not support starts nothing.
 */
function startProbes(recorder : MonitorRecorder, PerformanceObserver : PerformanceObserverInit, support : EntrySupport) : () => void {
    const probes : Array<{ stop() : void }> = [];
    if (support.longAnimationFrame) {
        probes.push(new LongAnimationFrameMonitor((report) => recorder.longAnimationFrame({
            startTime : report.startTime,
            duration : report.duration,
            blockingDuration : report.blockingDuration,
            renderDuration : report.renderDuration,
            ...(report.topScript ? {
                script : { invoker : report.topScript.invoker, invokerType : report.topScript.invokerType, duration : report.topScript.duration },
            } : {}),
        }), silentLogger, PerformanceObserver));
    }
    if (support.eventTiming) {
        probes.push(new EventTimingMonitor((report) => recorder.interaction({
            interactionId : report.interactionId,
            name : report.name,
            type : interactionType(report.name),
            startTime : report.startTime,
            duration : report.duration,
            inputDelay : Math.max(0, report.inputDelay),
            processingDuration : Math.max(0, report.processingDuration),
            presentationDelay : report.presentationDelay,
        }), silentLogger, PerformanceObserver));
    }
    if (support.layoutShift) {
        probes.push(new LayoutShiftMonitor(
            (report) => recorder.layoutShift({ startTime : report.startTime, value : report.value }),
            silentLogger,
            PerformanceObserver,
        ));
    }
    return () => {
        for (const probe of probes) probe.stop();
    };
}

/**
 * The dependencies of one demo: the browser dependencies without the APIs
 * that its monitor does not use. The demo does not watch other pages for
 * hangs, keeps no hang journal and gives no crash-report context.
 */
function demoDeps(focus : DemoFocus, meter : Meter, onLog : StartMonitorsOptions["onLog"]) : { deps : AllMonitorDeps; worker : LagWorker | undefined } {
    const apis = DEMO_APIS[focus];
    const worker = apis.includes("worker") ? tryCreateWorker() : undefined;
    const deps : Partial<AllMonitorDeps> = createBrowserDeps(window, {
        meter,
        logger : logger(onLog),
        ...(worker ? { worker, workerHeartbeatIntervalMs : PLAYGROUND_HEARTBEAT_MS } : {}),
        memoryIntervalMs : DEMO_MEMORY_INTERVAL_MS,
        peerHangWatch : false,
        hangJournal : false,
        crashReportContext : false,
        sharedMemory : false,
    });
    for (const [api, keys] of Object.entries(API_KEYS) as Array<[DemoApi, readonly OptionalDepKey[]]>) {
        if (apis.includes(api)) continue;
        for (const key of keys) delete deps[key];
    }
    for (const key of NO_DEMO_KEYS) delete deps[key];
    return { deps : deps as AllMonitorDeps, worker };
}

/** The dependencies of each monitor that the browser supports, with a worker. */
function allDeps(options : StartMonitorsOptions, recorder : MonitorRecorder | undefined) : { deps : AllMonitorDeps; worker : LagWorker | undefined } {
    const worker = tryCreateWorker();
    const deps = createBrowserDeps(window, {
        meter : options.meter,
        logger : logger(options.onLog),
        ...(recorder ? { events : recorder.events, spans : recorder.spans } : {}),
        ...(worker ? { worker, workerHeartbeatIntervalMs : PLAYGROUND_HEARTBEAT_MS } : {}),
    });
    return { deps, worker };
}

/**
 * This function starts each monitor that the browser supports, and a worker.
 * With `options.focus`, it starts only the monitor of that demo. The monitors
 * record into `options.meter`.
 */
export function startMonitors(options : StartMonitorsOptions) : StartedMonitors {
    const recorder = options.focus ? undefined : options.recorder;
    const { deps, worker } = options.focus ? demoDeps(options.focus, options.meter, options.onLog) : allDeps(options, recorder);

    let handles : ReturnType<typeof setupAllMonitors>;
    try {
        handles = setupAllMonitors(deps);
    } catch (error) {
        worker?.terminate();
        throw error;
    }

    const support = recorder ? entrySupport(deps.PerformanceObserver) : NO_SUPPORT;
    const stopProbes = recorder && deps.PerformanceObserver ? startProbes(recorder, deps.PerformanceObserver, support) : undefined;

    return {
        handles : {
            stop() {
                try {
                    stopProbes?.();
                } finally {
                    handles.stop();
                }
            },
        },
        worker,
        lifecycleState : () => handles.lifecycleStateMachine?.getState(),
        vitals : () => (handles.vitals?.getValues() ?? []).map(vital => ({
            name : vital.name,
            value : vital.value,
            time : vital.time,
            rating : rateVital(vital.name, vital.value),
        })),
        support,
    };
}
