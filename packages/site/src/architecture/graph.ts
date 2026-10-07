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
    module : "Module of @lag/core",
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

export const architectureNodes : readonly ArchNodeSpec[] = [
    // Packages
    {
        id : "site",
        label : "@lag/site",
        layer : "package",
        description : "This website. It shows the documentation, the test results and a live playground. The playground uses `@lag/core`, `@lag/worker` and `@lag/load`.",
        docs : "/docs/architecture",
        position : { x : C[0], y : 0 },
    },
    {
        id : "report",
        label : "@lag/report",
        layer : "package",
        description : "Defines the data contract of the test reports. The results viewer reads these files.",
        docs : "/results",
        position : { x : C[1], y : 0 },
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
        label : "@lag/worker",
        layer : "package",
        description : "`createLagWorker()` starts the Web Worker for the worker-lag monitor. The caller owns the worker and terminates it.",
        docs : "/docs/monitors/worker-lag",
        position : { x : C[4], y : 0 },
    },
    // @lag/core and its main modules
    {
        id : "core",
        label : "@lag/core",
        layer : "package",
        description : "The monitors, their OpenTelemetry wiring and `setupAllMonitors()`. The caller injects every browser API, so the package has no DOM or OpenTelemetry dependency.",
        docs : "/docs",
        position : { x : 0, y : 95 },
        size : { width : 520, height : 175 },
    },
    {
        id : "registry",
        label : "Monitor registry",
        layer : "module",
        description : "`MonitorRegistry` holds the handle of each monitor. `stopAll()` stops the handles in reverse order.",
        docs : "/docs/architecture",
        position : { x : 15, y : 40 },
        parent : "core",
    },
    {
        id : "instrumented",
        label : "Instrumented factories",
        layer : "module",
        description : "One factory for each monitor. A factory makes the monitor, connects it to metric instruments and returns a `MonitorHandle` with a `stop()`.",
        docs : "/docs/concepts/metrics-model",
        position : { x : 185, y : 40 },
        parent : "core",
    },
    {
        id : "monitors",
        label : "Monitors",
        layer : "module",
        description : "Classes that each measure one signal of main-thread health, for example `DriftLag` and `EventTimingMonitor`.",
        docs : "/docs/monitors",
        position : { x : 355, y : 40 },
        parent : "core",
    },
    {
        id : "lifecycle",
        label : "Lifecycle state machine",
        layer : "module",
        description : "`LifecycleStateMachine` tracks the Page Lifecycle state. The timer-driven monitors pause while the page is hidden or frozen.",
        docs : "/docs/concepts/page-lifecycle",
        position : { x : 15, y : 110 },
        parent : "core",
    },
    // Runtime
    {
        id : "otel-sdk",
        label : "OpenTelemetry SDK",
        layer : "runtime",
        description : "The OpenTelemetry SDK in the page. It collects the metric instruments and exports the metrics.",
        docs : "/docs/concepts/metrics-model",
        position : { x : 185, y : 320 },
    },
    {
        id : "main-thread",
        label : "Browser main thread",
        layer : "runtime",
        description : "Runs the app and the monitors. The monitors measure how long the main thread is busy.",
        docs : "/docs/concepts/event-loop",
        position : { x : C[3], y : 320 },
    },
    {
        id : "web-worker",
        label : "Web Worker",
        layer : "runtime",
        description : "Sends heartbeats from its own timer. The delay until the main thread handles a heartbeat shows main-thread blocking.",
        docs : "/docs/monitors/worker-lag",
        position : { x : C[4], y : 320 },
    },
    {
        id : "otlp",
        label : "OTLP over HTTP",
        layer : "runtime",
        description : "The OpenTelemetry protocol. The SDK sends the metrics to the backend with it.",
        docs : "/docs/operations/grafana-stack",
        position : { x : 185, y : 410 },
    },
    // Backend
    {
        id : "alloy",
        label : "Grafana Alloy",
        layer : "backend",
        description : "Receives the OTLP data and sends each signal to its store.",
        docs : "/docs/operations/grafana-stack",
        position : { x : 185, y : 500 },
    },
    {
        id : "mimir",
        label : "Mimir",
        layer : "backend",
        description : "Stores the metrics.",
        docs : "/docs/operations/grafana-stack",
        position : { x : 15, y : 590 },
    },
    {
        id : "loki",
        label : "Loki",
        layer : "backend",
        description : "Stores the logs.",
        docs : "/docs/operations/grafana-stack",
        position : { x : 185, y : 590 },
    },
    {
        id : "tempo",
        label : "Tempo",
        layer : "backend",
        description : "Stores the traces.",
        docs : "/docs/operations/grafana-stack",
        position : { x : 355, y : 590 },
    },
    {
        id : "grafana",
        label : "Grafana dashboards",
        layer : "backend",
        description : "Shows the dashboards. The dashboards read from Mimir, Loki and Tempo.",
        docs : "/docs/operations/dashboards",
        position : { x : 185, y : 680 },
    },
];

export const architectureEdges : readonly ArchEdgeSpec[] = [
    { source : "site", target : "core", label : "uses" },
    { source : "site", target : "report", label : "reads", from : "right", to : "left", hideLabel : true },
    { source : "worker", target : "core", label : "uses" },
    { source : "worker", target : "web-worker", label : "starts" },
    { source : "load", target : "main-thread", label : "makes load" },
    { source : "registry", target : "instrumented", label : "holds the handles of", from : "right", to : "left", hideLabel : true },
    { source : "instrumented", target : "monitors", label : "makes", from : "right", to : "left", hideLabel : true },
    { source : "instrumented", target : "lifecycle", label : "pauses with", to : "right" },
    { source : "instrumented", target : "otel-sdk", label : "records metrics" },
    { source : "monitors", target : "main-thread", label : "measure" },
    { source : "web-worker", target : "main-thread", label : "sends heartbeats to", from : "left", to : "right", hideLabel : true },
    { source : "otel-sdk", target : "otlp", label : "exports" },
    { source : "otlp", target : "alloy" },
    { source : "alloy", target : "mimir", label : "metrics" },
    { source : "alloy", target : "loki", label : "logs" },
    { source : "alloy", target : "tempo", label : "traces" },
    { source : "mimir", target : "grafana" },
    { source : "loki", target : "grafana" },
    { source : "tempo", target : "grafana" },
];
