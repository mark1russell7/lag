/**
 * The only module of the site that uses `@lag/core` and `@lag/worker`.
 *
 * The core API changes often. The site uses only `setupAllMonitors`, the
 * `Meter` type and `createLagWorker`, so when the API changes, update this
 * file and nothing else.
 */
import { setupAllMonitors } from "@lag/core";
import { createLagWorker } from "@lag/worker";

export type {
    Attributes,
    Counter,
    Histogram,
    Meter,
    ObservableCallback,
    ObservableGauge,
    ObservableResult,
} from "@lag/core";

import type { Meter } from "@lag/core";

type MonitorDeps = Parameters<typeof setupAllMonitors>[0];
type MemorySource = NonNullable<MonitorDeps["memorySource"]>;
type LegacyMemory = ReturnType<NonNullable<MemorySource["readLegacy"]>>;
type ModernMemory = Awaited<ReturnType<NonNullable<MemorySource["measureModern"]>>>;
type LagWorker = ReturnType<typeof createLagWorker>;

/** The names of the instruments that the site reads from its meter. */
export const METRICS = {
    driftLag : "lag_drift_histogram",
    workerMainBlock : "lag_worker_main_block_histogram",
    frameDelta : "lag_frame_delta_histogram",
    eventDuration : "lag_inp_histogram",
    gcEvents : "lag_gc_events",
    lifecycleTransitions : "lag_lifecycle_transitions",
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
    /** What `setupAllMonitors` returns. `stop()` releases every timer, listener, observer and gauge callback. */
    readonly handles : { stop() : void };
    /** The worker of the worker-lag monitor, if the browser can start one. The caller must terminate it. */
    readonly worker : { terminate() : void } | undefined;
    /** The Page Lifecycle state now, for example "active". */
    lifecycleState() : string | undefined;
};

export type StartMonitorsOptions = {
    meter : Meter;
    scope : MonitorScope;
    onLog? : (entry : MonitorLogEntry) => void;
};

/** The playground needs more than one heartbeat per second (the default) to draw a line. */
const PLAYGROUND_HEARTBEAT_MS = 100;

type BrowserPerformance = Performance & {
    memory? : LegacyMemory;
    measureUserAgentSpecificMemory? : () => Promise<ModernMemory>;
};

function tryCreateWorker() : LagWorker | undefined {
    if (typeof Worker === "undefined") return undefined;
    try {
        return createLagWorker();
    } catch {
        return undefined;
    }
}

function baseDeps(meter : Meter, onLog : StartMonitorsOptions["onLog"]) : MonitorDeps {
    return {
        meter,
        logger : {
            log(level, message) {
                onLog?.({ level, message });
            },
        },
        clock : { now : () => performance.now() },
        setTimeoutFn : (fn, ms) => window.setTimeout(fn, ms),
        clearTimeoutFn : (id) => window.clearTimeout(id),
        setIntervalFn : (fn, ms) => window.setInterval(fn, ms),
        clearIntervalFn : (id) => window.clearInterval(id),
        document,
        window,
    };
}

/** The same deps as `createBrowserDeps` in `packages/lag-integration-tests/src/harness.ts`. */
function browserDeps(meter : Meter, worker : LagWorker | undefined, onLog : StartMonitorsOptions["onLog"]) : MonitorDeps {
    const perf = window.performance as BrowserPerformance;
    const memorySource : MemorySource = {};
    if (perf.memory) memorySource.readLegacy = () => perf.memory;
    const measure = perf.measureUserAgentSpecificMemory;
    if (measure && globalThis.crossOriginIsolated) memorySource.measureModern = () => measure.call(perf);
    const PressureObserver = (window as unknown as { PressureObserver? : MonitorDeps["PressureObserver"] }).PressureObserver;

    return {
        ...baseDeps(meter, onLog),
        performance : window.performance,
        PerformanceObserver : window.PerformanceObserver,
        requestAnimationFrame : (cb) => window.requestAnimationFrame(cb),
        cancelAnimationFrame : (id) => window.cancelAnimationFrame(id),
        ...(typeof window.requestIdleCallback === "function" ? {
            requestIdleCallback : (cb, opts) => window.requestIdleCallback(cb, opts),
            cancelIdleCallback : (id) => window.cancelIdleCallback(id),
        } satisfies Pick<MonitorDeps, "requestIdleCallback" | "cancelIdleCallback"> : {}),
        MessageChannel : window.MessageChannel,
        queueMicrotask : (cb) => window.queueMicrotask(cb),
        memorySource,
        FinalizationRegistry : window.FinalizationRegistry,
        ...(worker ? { worker, workerHeartbeatIntervalMs : PLAYGROUND_HEARTBEAT_MS } : {}),
        ...(PressureObserver ? { PressureObserver, pressureSources : ["cpu" as const] } : {}),
    };
}

/** Starts the monitors in this page. They record into `options.meter`. */
export function startMonitors(options : StartMonitorsOptions) : StartedMonitors {
    const worker = options.scope === "all" ? tryCreateWorker() : undefined;
    const deps = options.scope === "all"
        ? browserDeps(options.meter, worker, options.onLog)
        : baseDeps(options.meter, options.onLog);

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
