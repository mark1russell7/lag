/**
 * The types that the page and the runner of experiment E8 share. The page
 * gives these values to the runner through `window.e8`.
 */

/**
 * The setups of the experiment:
 *
 * - A: otel-ts with `contextManager: "stack"`, without zone.js.
 * - B: otel-ts with `contextManager: "zone"` (the default).
 * - C: async-browser-context, with its Vite plugin and its context manager.
 * - D: otel-ts with `contextManager: "stack"`, as the package is. Its static
 *   import of `@opentelemetry/context-zone` also loads zone.js.
 */
export const SETUP_IDS = ["A", "B", "C", "D"] as const;
export type SetupId = (typeof SETUP_IDS)[number];

export const SETUP_LABELS : Readonly<Record<SetupId, string>> = {
    A : "A. No async context (stack, without zone.js)",
    B : "B. Zone.js (zone)",
    C : "C. AsyncBrowserContext",
    D : "D. stack, with zone.js loaded",
};

/** The fixed amounts of asynchronous work of measurement 2. */
export const WORKLOAD_NAMES = [
    "promise-chain",
    "await-loop",
    "async-calls",
    "microtasks",
    "timers",
    "events",
    "fetch",
    "operations",
] as const;
export type WorkloadName = (typeof WORKLOAD_NAMES)[number];

/** The cases of the context check (measurement 4). */
export const CORRECTNESS_CASES = [
    "sync",
    "promise-then",
    "await",
    "set-timeout",
    "listener-browser-dispatch",
    "listener-code-dispatch",
    "fetch-then",
    "await-fetch",
    "no-leak",
] as const;
export type CorrectnessCase = (typeof CORRECTNESS_CASES)[number];

/** The facts of a loaded page. They show that the build has the right setup. */
export type SetupFacts = {
    setup : SetupId;
    /** The `contextManager` option of otel-ts: "stack", "zone", or the class name. */
    contextManager : string;
    /** True if the global `Zone` exists, thus zone.js patched the page. */
    zoneLoaded : boolean;
    /** True if the store of async-browser-context exists, thus its patches are installed. */
    asyncContextInstalled : boolean;
    userAgent : string;
};

/** The values of an idle window with the monitors (measurement 3). */
export type IdleReadings = {
    /** The values of `lag_drift_histogram` in the window, in ms. */
    drift : number[];
};

/** The values of the probes that sample faster than the defaults (measurement 3). */
export type ProbeReadings = {
    /** MacrotaskLag: the time that a `setTimeout(0)` waits, in ms. */
    macrotask : number[];
    /** SchedulingFairnessMonitor, in ms. */
    microtask : number[];
    schedulingMacrotask : number[];
    messageChannel : number[];
};

/** The values of the scripted clicks (measurement 3). */
export type ClickReadings = {
    /** The INP of lag (PageViewVitals), or undefined if the browser has no Event Timing. */
    lagInpMs : number | undefined;
    /** The duration of each interaction, from the Event Timing entries of the page, in ms. */
    interactionMs : number[];
    /** The values of `lag_event_duration_histogram`, in ms. */
    eventDurationMs : number[];
};

/** The script of a long animation frame that took the most time. */
export type LoafScript = {
    invoker : string;
    invokerType : string;
    sourceFunctionName : string;
    sourceURL : string;
    duration : number;
};

/** The values of the fixed blocking tasks (measurement 3). */
export type LoafReadings = {
    /** False if the browser has no long animation frame entries. */
    supported : boolean;
    /** The values of `lag_loaf_blocking_histogram`, in ms. */
    blockingMs : number[];
    /** The longest script of each long frame of a blocking task. */
    topScripts : LoafScript[];
};

export type CorrectnessResult = Record<CorrectnessCase, boolean>;

/** The API that the page puts on `window.e8`. */
export type E8Page = {
    ready : boolean;
    facts() : SetupFacts;
    now() : number;
    startMonitors() : void;
    stopMonitors() : void;
    idleReadings(since : number) : IdleReadings;
    startProbes(intervalMs : number) : void;
    stopProbes() : ProbeReadings;
    clickReadings(since : number) : ClickReadings;
    /** This method starts a task of `ms` milliseconds of work in a `setTimeout(0)` callback. */
    blockTask(ms : number) : void;
    loafReadings(since : number) : LoafReadings;
    /** This method does one workload and gives its duration, in ms. */
    runWorkload(name : WorkloadName) : Promise<number>;
    correctness() : Promise<CorrectnessResult>;
};

/** The selector of the button that the runner clicks. */
export const CLICK_TARGET = "#e8-click";
/** The work of the click handler, in ms. */
export const CLICK_HANDLER_MS = 100;
/** The work of the fixed blocking task, in ms. */
export const BLOCKING_TASK_MS = 150;
/** The name of the function of the fixed blocking task. The long animation frame entries can name it. */
export const BLOCKING_TASK_NAME = "fixedBlockingTask";
/** The path of the resource that the fetch workloads get. The runner serves it. */
export const DATA_PATH = "e8-data.json";
/** The path of the OTLP endpoint of the page. The runner answers it and counts the requests. */
export const OTLP_PATH = "/otlp";
