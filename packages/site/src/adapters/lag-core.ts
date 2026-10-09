/**
 * The only module of the site that uses `@lag/core` and `@lag/worker`.
 *
 * When the API of the core changes, update this file and nothing else. The
 * site uses `setupAllMonitors`, `createBrowserDeps`, the metric catalog, the
 * `Meter` type and `createLagWorker`.
 */
import {
    METRICS as CATALOG,
    METRIC_CATALOG,
    EVENT_CATALOG,
    SPAN_CATALOG,
    createBrowserDeps,
    setupAllMonitors,
    type AllMonitorDeps,
    type Meter,
} from "@lag/core";
import { createLagWorker } from "@lag/worker";

export type { Attributes, Counter, Histogram, Meter, MetricDefinition, EventDefinition, SpanDefinition } from "@lag/core";

/** Every metric, event and span that the monitors emit: the single source for the documentation. */
export { METRIC_CATALOG, EVENT_CATALOG, SPAN_CATALOG };

type LagWorker = ReturnType<typeof createLagWorker>;

/** The names of the instruments that the site reads from its meter. */
export const METRICS = {
    driftLag : CATALOG.drift.name,
    workerMainBlock : CATALOG.workerMainBlock.name,
    frameDelta : CATALOG.frameDelta.name,
    eventDuration : CATALOG.eventDuration.name,
    gcEvents : CATALOG.gcEvents.name,
    lifecycleTransitions : CATALOG.lifecycleTransitions.name,
} as const;

/** The instruments that the session reads. A test runtime can give other names. */
export type MetricNames = { readonly [K in keyof typeof METRICS] : string };

/**
 * - `all`: every monitor that the browser supports, and a worker.
 * - `timers`: only the monitors that need timers (a small cost, for the home page).
 */
export type MonitorScope = "all" | "timers";

export type MonitorLogEntry = {
    level : string;
    message : string;
};

export type StartedMonitors = {
    /** What `setupAllMonitors` gives. `stop()` releases every timer, listener and observer. */
    readonly handles : { stop() : void };
    /** The worker of the worker-lag monitor, if the browser can start one. The caller must stop it (`terminate()`). */
    readonly worker : { terminate() : void } | undefined;
    /** The Page Lifecycle state at this time, for example "active". */
    lifecycleState() : string | undefined;
};

export type StartMonitorsOptions = {
    meter : Meter;
    scope : MonitorScope;
    onLog? : (entry : MonitorLogEntry) => void;
};

/** The playground needs more than one heartbeat each second (the default) to draw a line. */
const PLAYGROUND_HEARTBEAT_MS = 100;

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

/** This function starts the monitors in this page. They record into `options.meter`. */
export function startMonitors(options : StartMonitorsOptions) : StartedMonitors {
    const worker = options.scope === "all" ? tryCreateWorker() : undefined;
    const deps = options.scope === "all"
        ? createBrowserDeps(window, {
            meter : options.meter,
            logger : logger(options.onLog),
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

    return {
        handles,
        worker,
        lifecycleState : () => handles.lifecycleStateMachine?.getState(),
    };
}
