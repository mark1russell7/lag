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
    type PerformanceObserverInit,
    type Rating,
    type SpanSink,
} from "@mark1russell7/lag";
import { createLagWorker } from "@mark1russell7/lag/worker";

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
 * - `all`: every monitor that the browser supports, and a worker.
 * - `timers`: only the monitors that need timers (a small cost, for the home page).
 */
export type MonitorScope = "all" | "timers";

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
    scope : MonitorScope;
    onLog? : (entry : MonitorLogEntry) => void;
    /** The receiver of the events, the spans and the entries, for the timeline. Only the scope `all` uses it. */
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

/** Only the deps that the timer monitors use. */
function timerDeps(meter : Meter, onLog : StartMonitorsOptions["onLog"]) : AllMonitorDeps {
    return {
        meter,
        logger : logger(onLog),
        clock : { now : () => performance.now() },
        setTimeoutFn : (fn, ms) => window.setTimeout(fn, ms),
        clearTimeoutFn : (id) => window.clearTimeout(id),
        setIntervalFn : (fn, ms) => window.setInterval(fn, ms),
        clearIntervalFn : (id) => window.clearInterval(id),
        document,
        window,
    };
}

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

/** This function starts the monitors in this page. They record into `options.meter`. */
export function startMonitors(options : StartMonitorsOptions) : StartedMonitors {
    const worker = options.scope === "all" ? tryCreateWorker() : undefined;
    const recorder = options.scope === "all" ? options.recorder : undefined;
    const deps = options.scope === "all"
        ? createBrowserDeps(window, {
            meter : options.meter,
            logger : logger(options.onLog),
            ...(recorder ? { events : recorder.events, spans : recorder.spans } : {}),
            ...(worker ? { worker, workerHeartbeatIntervalMs : PLAYGROUND_HEARTBEAT_MS } : {}),
        })
        : timerDeps(options.meter, options.onLog);

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
