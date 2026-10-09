/**
 * The data of the architecture map: the packages, the runtime and the backend.
 * Positions are in map units (the map scales to fit). To add a box, add a node
 * here and connect it with an edge. Keep edges away from other boxes: give an
 * edge its sides (`from`, `to`) when the default (bottom to top) crosses a box.
 */

export type ArchLayer = "package" | "module" | "runtime" | "backend";

export type ArchSide = "top" | "right" | "bottom" | "left";

export type ArchNodeSpec = {
    id : string;
    label : string;
    layer : ArchLayer;
    /** One or two sentences. The side panel shows it. Backticks mark technical names. */
    description : string;
    /** A site path to read more, for example "/docs/monitors". */
    docs? : string;
    /** The position: relative to the parent, if the node has one. */
    position : { x : number; y : number };
    /** The ID of a group node that contains this node. */
    parent? : string;
    /** The size of a group node. */
    size? : { width : number; height : number };
};

export type ArchEdgeSpec = {
    source : string;
    target : string;
    /** A short verb phrase, for example "exports". */
    label? : string;
    /** The side of the source box where the edge starts. The default is "bottom". */
    from? : ArchSide;
    /** The side of the target box where the edge ends. The default is "top". */
    to? : ArchSide;
    /** Do not draw the label on the map (a short edge has no room). The panel and the list still show it. */
    hideLabel? : boolean;
};

export const LAYER_LABELS : Readonly<Record<ArchLayer, string>> = {
    package : "Package",
    module : "Module of @mark1russell7/lag",
    runtime : "Runtime",
    backend : "Backend",
};

/** How the map draws each layer. The legend under the map uses this text. */
export const LAYER_SHAPES : Readonly<Record<ArchLayer, string>> = {
    package : "a box with a solid border",
    module : "a shaded box",
    runtime : "a box with a dashed border",
    backend : "a round box",
};

// Five columns, 170 units apart. Rows are 90 units apart.
const C = [0, 170, 340, 510, 680] as const;

/** The vertical offset of the runtime and backend rows, under the box of @mark1russell7/lag. */
const R = 70;

export const architectureNodes : readonly ArchNodeSpec[] = [
    // Packages
    {
        id : "site",
        label : "@lag/site",
        layer : "package",
        description : "This website. It shows the documentation, the test results and a live playground. The playground uses `@mark1russell7/lag`, `@mark1russell7/lag/worker` and `@lag/load`.",
        docs : "/docs/architecture",
        position : { x : C[0], y : 0 },
    },
    {
        id : "report",
        label : "@lag/report",
        layer : "package",
        description : "The data contract of the test reports, and the converters from the reports of Vitest, Istanbul and Stryker. The results viewer reads these files.",
        docs : "/results",
        position : { x : C[1], y : 0 },
    },
    {
        id : "ste-lint",
        label : "@mark1russell7/ste-lint",
        layer : "package",
        description : "Examines the text of the site, the READMEs and the TSDoc comments against the writing rules of ASD-STE100. It is an automated approximation, not a certification.",
        docs : "/docs/contributing/writing-style",
        position : { x : C[2], y : 0 },
    },
    {
        id : "load",
        label : "@lag/load",
        layer : "package",
        description : "Makes synthetic main-thread load: busy loops, layout thrash, garbage, long animation frames and task floods. The tests and the playground use it.",
        docs : "/docs/testing/strategy",
        position : { x : C[3], y : 0 },
    },
    {
        id : "worker",
        label : "@mark1russell7/lag/worker",
        layer : "package",
        description : "The export `./worker` of the package. `createLagWorker()` starts the Web Worker for the worker-lag monitor. The worker sends heartbeats, detects hangs, and keeps the hang journal. The caller owns the worker and stops it with `terminate()`.",
        docs : "/docs/monitors/worker-lag",
        position : { x : C[4], y : 0 },
    },
    // @mark1russell7/lag and its main modules
    {
        id : "core",
        label : "@mark1russell7/lag",
        layer : "package",
        description : "The monitors, their OpenTelemetry wiring and `setupAllMonitors()`. The caller gives every browser API, thus the package has no DOM or OpenTelemetry dependency.",
        docs : "/docs",
        position : { x : 0, y : 95 },
        size : { width : 520, height : 245 },
    },
    {
        id : "registry",
        label : "Monitor registry",
        layer : "module",
        description : "`setupAllMonitors()` adds the handle of each monitor to a `MonitorRegistry`. `stopAll()` stops the handles in the reverse sequence.",
        docs : "/docs/architecture",
        position : { x : 15, y : 40 },
        parent : "core",
    },
    {
        id : "instrumented",
        label : "Instrumented factories",
        layer : "module",
        description : "One factory for each monitor. A factory makes the monitor, makes its instruments from the metric catalog, and gives a `MonitorHandle` with a `stop()`.",
        docs : "/docs/architecture",
        position : { x : 185, y : 40 },
        parent : "core",
    },
    {
        id : "monitors",
        label : "Monitors",
        layer : "module",
        description : "Classes that each measure one signal of main-thread health, for example `DriftLag`, `WorkerLagMonitor` and `EventTimingMonitor`.",
        docs : "/docs/monitors",
        position : { x : 355, y : 40 },
        parent : "core",
    },
    {
        id : "lifecycle",
        label : "Lifecycle state machine",
        layer : "module",
        description : "`LifecycleStateMachine` follows the Page Lifecycle state, with capture-phase listeners. Its subscribers know about each change before an exporter flushes.",
        docs : "/docs/concepts/page-lifecycle",
        position : { x : 15, y : 110 },
        parent : "core",
    },
    {
        id : "conditions",
        label : "Measurement conditions",
        layer : "module",
        description : "The reliability tracker and the sample validators. They discard each sample that overlaps a hidden, frozen or suspended interval, and they classify very long samples as a hang or a suspend.",
        docs : "/docs/concepts/measurement-validity",
        position : { x : 185, y : 110 },
        parent : "core",
    },
    {
        id : "catalog",
        label : "Metric catalog",
        layer : "module",
        description : "The single list of every metric and event: name, type, unit and the permitted attribute values. The factories and this website read it, and a test makes sure that the code agrees with it.",
        docs : "/docs/concepts/metrics-model",
        position : { x : 355, y : 110 },
        parent : "core",
    },
    {
        id : "adapter",
        label : "Browser adapter",
        layer : "module",
        description : "`createBrowserDeps(window, options)` is the only part that reads the browser globals. It examines each API, so that each browser gets the monitors that it can support.",
        docs : "/docs/getting-started",
        position : { x : 15, y : 180 },
        parent : "core",
    },
    {
        id : "vitals",
        label : "Page-view vitals",
        layer : "module",
        description : "The Core Web Vitals of each page view (a load, a back/forward cache restore or a soft navigation), with the rules of web-vitals. Each event gets the ID of the current page view.",
        docs : "/docs/concepts/page-views",
        position : { x : 185, y : 180 },
        parent : "core",
    },
    {
        id : "clocks",
        label : "Clocks",
        layer : "module",
        description : "One absolute clock that reads `timeOrigin` one time, the clock-drift monitor that detects suspends and clock steps, and the clock sync with the worker.",
        docs : "/docs/concepts/clocks-and-time",
        position : { x : 355, y : 180 },
        parent : "core",
    },
    // Runtime
    {
        id : "otel-sdk",
        label : "otel-ts and the OpenTelemetry SDK",
        layer : "runtime",
        description : "`otel-ts` starts the OpenTelemetry SDK in the page: one `service.instance.id` for each SDK instance, exponential histograms, and a flush when the page becomes hidden. Its `onBeforeFlush` hook uses `monitors.flush()`.",
        docs : "/docs/operations/opentelemetry",
        position : { x : 185, y : 320 + R },
    },
    {
        id : "main-thread",
        label : "Browser main thread",
        layer : "runtime",
        description : "Does the work of the app and of the monitors. The monitors measure how long the main thread is busy.",
        docs : "/docs/concepts/event-loop",
        position : { x : C[3], y : 320 + R },
    },
    {
        id : "web-worker",
        label : "Web Worker",
        layer : "runtime",
        description : "Sends heartbeats from its own timer. The delay until the main thread handles a heartbeat shows main-thread blocking. During a hang, the worker reports the hang itself.",
        docs : "/docs/monitors/worker-lag",
        position : { x : C[4], y : 320 + R },
    },
    {
        id : "indexeddb",
        label : "IndexedDB hang journal",
        layer : "runtime",
        description : "The worker keeps a record of each hang in progress. The next page of the origin reports the records of hangs that a page did not survive.",
        docs : "/docs/concepts/survivorship",
        position : { x : C[4], y : 410 + R },
    },
    {
        id : "otlp",
        label : "OTLP over HTTP",
        layer : "runtime",
        description : "The OpenTelemetry protocol. The SDK sends the metrics and the events with it. The worker sends its hang reports in the same format.",
        docs : "/docs/operations/grafana-stack",
        position : { x : 185, y : 410 + R },
    },
    // Backend
    {
        id : "alloy",
        label : "Grafana Alloy",
        layer : "backend",
        description : "Receives the OTLP data and sends each signal to its store.",
        docs : "/docs/operations/grafana-stack",
        position : { x : 185, y : 500 + R },
    },
    {
        id : "mimir",
        label : "Mimir",
        layer : "backend",
        description : "Stores the metrics, as native histograms and counters.",
        docs : "/docs/operations/grafana-stack",
        position : { x : 15, y : 590 + R },
    },
    {
        id : "loki",
        label : "Loki",
        layer : "backend",
        description : "Stores the events (log records with an event name). The details go into structured metadata.",
        docs : "/docs/operations/grafana-stack",
        position : { x : 185, y : 590 + R },
    },
    {
        id : "tempo",
        label : "Tempo",
        layer : "backend",
        description : "Stores the traces.",
        docs : "/docs/operations/grafana-stack",
        position : { x : 355, y : 590 + R },
    },
    {
        id : "grafana",
        label : "Grafana dashboards",
        layer : "backend",
        description : "Shows the dashboards. The dashboards read from Mimir, Loki and Tempo.",
        docs : "/docs/operations/dashboards",
        position : { x : 185, y : 680 + R },
    },
];

export const architectureEdges : readonly ArchEdgeSpec[] = [
    { source : "site", target : "core", label : "uses" },
    { source : "site", target : "report", label : "reads", from : "right", to : "left", hideLabel : true },
    { source : "ste-lint", target : "site", label : "examines the text of", from : "left", to : "right", hideLabel : true },
    { source : "worker", target : "core", label : "uses" },
    { source : "worker", target : "web-worker", label : "starts" },
    { source : "load", target : "main-thread", label : "makes load" },
    { source : "registry", target : "instrumented", label : "holds the handles of", from : "right", to : "left", hideLabel : true },
    { source : "instrumented", target : "monitors", label : "makes", from : "right", to : "left", hideLabel : true },
    { source : "instrumented", target : "conditions", label : "validates samples with" },
    { source : "instrumented", target : "catalog", label : "makes instruments from", from : "right", to : "top", hideLabel : true },
    { source : "conditions", target : "lifecycle", label : "pauses with", from : "left", to : "right", hideLabel : true },
    { source : "instrumented", target : "otel-sdk", label : "records metrics and events", from : "bottom", to : "top" },
    { source : "monitors", target : "main-thread", label : "measure", from : "right", to : "top" },
    { source : "web-worker", target : "main-thread", label : "sends heartbeats to", from : "left", to : "right", hideLabel : true },
    { source : "web-worker", target : "indexeddb", label : "writes" },
    { source : "web-worker", target : "otlp", label : "reports hangs", from : "bottom", to : "right" },
    { source : "otel-sdk", target : "otlp", label : "exports" },
    { source : "otlp", target : "alloy" },
    { source : "alloy", target : "mimir", label : "metrics" },
    { source : "alloy", target : "loki", label : "events" },
    { source : "alloy", target : "tempo", label : "traces" },
    { source : "mimir", target : "grafana" },
    { source : "loki", target : "grafana" },
    { source : "tempo", target : "grafana" },
];
