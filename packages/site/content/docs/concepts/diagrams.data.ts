/**
 * The Mermaid diagrams and the table data of the concept pages. Each diagram
 * follows the code that it shows. The comment of each diagram names the
 * source file in `packages/lag/src`.
 */
import { EVENT_CATALOG, METRIC_CATALOG, SPAN_CATALOG } from "../../../src/adapters/lag-core";
import type { DataTableSpec } from "../../../src/components/DataTable/DataTable";

/** The event loop, simplified: one task, then all microtasks, then sometimes a rendering update. */
export const eventLoopChart = `
flowchart LR
    queues["Task queues"] --> task["Do one task to its end"]
    task --> micro["Do all microtasks"]
    micro --> check{"Rendering<br/>opportunity?"}
    check -- "no" --> queues
    check -- "yes" --> render["Animation frame callbacks,<br/>style, layout, paint"]
    render --> queues
`;

/**
 * The states and transitions of `LifecycleStateMachine.ts`. In the code,
 * `freeze`, `resume`, `pagehide` and `pageshow` can change each state. The
 * diagram shows the usual source states.
 */
export const lifecycleChart = `
stateDiagram-v2
    direction LR
    state "visible: active or passive" as visible
    state visible {
        [*] --> active: focus
        [*] --> passive: no focus
        active --> passive: blur
        passive --> active: focus
    }
    [*] --> visible
    [*] --> hidden: visibilityState is hidden
    visible --> hidden: visibilitychange
    hidden --> visible: visibilitychange
    hidden --> frozen: freeze
    frozen --> hidden: resume
    visible --> frozen: pagehide, persisted
    hidden --> frozen: pagehide, persisted
    frozen --> visible: pageshow, persisted
    visible --> terminated: pagehide, not persisted
    hidden --> terminated: pagehide, not persisted
    terminated --> [*]
`;

/**
 * The final values of a page and the flush of the exporter in Chromium
 * (`setup-all-monitors.ts`, otel-ts `onBeforeFlush`). At `window`, Chromium
 * starts the listener that the page added first (experiment E1).
 */
export const flushSequenceChart = `
sequenceDiagram
    participant B as Browser
    participant O as otel-ts
    participant M as Monitors
    participant L as Lifecycle state machine
    B->>O: pagehide (listener added first)
    O->>M: onBeforeFlush: monitors.flush(pagehide)
    M->>O: record the values of the page view
    O->>O: export the telemetry and stop
    B->>L: pagehide (capture listener)
    L->>M: transition to terminated
    Note over M: the final checkpoint records no new histogram value
`;

/**
 * The sample validator of `measurement-conditions.ts`. The validator looks
 * for a suspend interval first. The stall samples whose windows overlap are
 * one stall episode.
 */
export const validatorChart = `
flowchart TD
    submit["submit(value, windowMs)"] --> sync["Read the lifecycle state"]
    sync --> first{"Does the window overlap<br/>an interval? A suspend first"}
    first -- "yes" --> discard["Discard the sample"]
    first -- "no" --> long{"value ≥ 5000 ms?"}
    long -- "no" --> record["Record the sample"]
    long -- "yes" --> wait["Wait 2000 ms"]
    wait --> second{"Does the window overlap<br/>an interval now?"}
    second -- "no" --> hang["Stall sample of the type hang,<br/>record the sample"]
    second -- "yes" --> discard
    discard --> evidence{"A suspend interval,<br/>and value ≥ 5000 ms?"}
    evidence -- "yes" --> suspend["Stall sample of the type suspend"]
    evidence -- "no" --> nostall["No stall"]
    hang --> episode["The stall episode of the window"]
    suspend --> episode
`;

/** The classification of one sample of `ClockDriftMonitor.ts`. The lateness of the timer has no effect. */
export const clockDriftChart = `
flowchart TD
    read["Read now(), Date.now(), now()"] --> spread{"Are the two reads of now()<br/>more than 1 ms apart?"}
    spread -- "yes" --> ignore["Ignore the sample"]
    spread -- "no" --> change{"Is the change of the skew<br/>above max(50 ms, 3% of the interval)?"}
    change -- "no" --> none["No jump"]
    change -- "yes" --> forward{"Forward by 1 s or more?"}
    forward -- "yes" --> suspend["Jump of the type suspend"]
    forward -- "no" --> step["Jump of the type step"]
`;

/** One synchronization of `WorkerClockSync.ts`. */
export const clockSyncChart = `
sequenceDiagram
    participant M as Main thread
    participant W as Worker
    loop 8 exchanges, one after the other
        M->>W: sync, sent at t0
        W-->>M: sync-reply, worker time t1
        Note over M: received at t2
    end
    Note over M: offset = t1 − (t0 + t2) / 2, from the shortest round trip
    Note over M: the best result of all synchronizations stays
`;

/** The page views and the checkpoints of `vitals/PageViewVitals.ts`. */
export const pageViewChart = `
sequenceDiagram
    participant B as Browser
    participant V as PageViewVitals
    participant T as Metrics and events
    B->>V: load
    Note over V: view 1, navigate
    B->>V: the page becomes hidden
    V->>T: checkpoint: first values of view 1
    B->>V: the page becomes visible
    B->>V: pagehide, persisted
    V->>T: checkpoint
    B->>V: pageshow, persisted
    V->>T: final checkpoint of view 1
    Note over V: view 2, back-forward-cache
`;

/** The page-view context of `instrumented/page-view-context.ts`. */
export const pageViewContextChart = `
sequenceDiagram
    participant V as PageViewVitals
    participant C as Page-view context
    participant W as Worker
    participant R as window.crashReport
    V->>C: a new page view starts
    C->>W: context message with lag.page_view.id
    C->>R: set the key lag.page_view.id
    Note over W: each hang report of the worker has the ID
    Note over R: a crash report of an unresponsive page has the ID
`;

/**
 * A hang that the worker detects (`lag-worker.ts`, `@lag/worker`). Each
 * message from the main thread ends the hang: an `ack`, a `stop` or a `start`.
 */
export const hangSequenceChart = `
sequenceDiagram
    participant M as Main thread
    participant W as Worker
    participant J as Hang journal
    participant C as Collector
    W->>M: heartbeat
    M-->>W: ack
    Note over M: a long task starts
    W->>M: heartbeats wait in the queue
    Note over W: 5 s without an ack
    W->>C: hang started (fetch with keepalive)
    W->>J: put the record
    loop each second while the hang continues
        W->>J: put the record again
    end
    Note over M: the long task stops
    M-->>W: ack, or stop when the page became hidden
    W->>J: remove the record
    W->>C: hang ended (fetch with keepalive)
    W->>M: hang-ended
    Note over M: lag_main_thread_hangs, outcome ended
`;

/**
 * A hang that the page did not survive (`hang-journal.ts`,
 * `instrumented/worker-lag.ts`). The take is atomic, thus only one page gets
 * the record.
 */
export const abandonedHangChart = `
sequenceDiagram
    participant W as Worker of page 1
    participant J as Hang journal
    participant P as Page 2 of the same origin
    W->>J: put the record of the hang
    Note over W: page 1 closes during the hang
    Note over J: no update for 30 s or more
    P->>J: list all records, one time at the start
    J-->>P: the record of page 1
    P->>J: take the record, only if it is still stale
    J-->>P: the record, to one page only
    Note over P: lag_main_thread_hangs, outcome abandoned
`;

/** The events of `EVENT_CATALOG`, for a `DataTable`. */
export const eventTable : DataTableSpec = {
    caption : "The events of the monitors, from the event catalog",
    columns : [
        { key : "name", label : "Event" },
        { key : "monitor", label : "Monitor" },
        { key : "attributes", label : "Attributes" },
    ],
    rows : EVENT_CATALOG.map(event => ({
        name : event.name,
        monitor : event.monitor,
        attributes : event.attributes.join(", "),
    })),
};

/** The spans of `SPAN_CATALOG`, for a `DataTable`. */
export const spanTable : DataTableSpec = {
    caption : "The spans of the monitors, from the span catalog",
    columns : [
        { key : "name", label : "Span" },
        { key : "monitor", label : "Monitor" },
        { key : "description", label : "Period" },
        { key : "attributes", label : "Attributes" },
    ],
    rows : SPAN_CATALOG.map(span => ({
        name : span.name,
        monitor : span.monitor,
        description : span.description,
        attributes : span.attributes.join(", "),
    })),
};

/** A boundary of a histogram, with a binary unit for byte counts. */
function formatBoundary(unit : string, value : number) : string {
    if (unit !== "By") return String(value);
    return value >= 2 ** 30 ? `${value / 2 ** 30} GiB` : `${value / 2 ** 20} MiB`;
}

type BucketRow = { unit : string; boundaries : string; histograms : string[] };

function bucketRows() : BucketRow[] {
    const rows = new Map<string, BucketRow>();
    for (const definition of METRIC_CATALOG) {
        const values = definition.advice?.explicitBucketBoundaries;
        if (definition.kind !== "histogram" || !values) continue;
        const boundaries = values.map(value => formatBoundary(definition.unit, value)).join(", ");
        const row = rows.get(boundaries) ?? { unit : definition.unit, boundaries, histograms : [] };
        row.histograms.push(definition.name);
        rows.set(boundaries, row);
    }
    return [...rows.values()];
}

/** The bucket boundaries of the histograms of `METRIC_CATALOG`, one row for each set of boundaries. */
export const bucketTable : DataTableSpec = {
    caption : "The bucket boundaries of the histograms, from the metric catalog",
    columns : [
        { key : "unit", label : "Unit" },
        { key : "boundaries", label : "Boundaries" },
        { key : "histograms", label : "Histograms" },
    ],
    rows : bucketRows().map(row => ({
        unit : row.unit,
        boundaries : row.boundaries,
        histograms : row.histograms.length > 4 ? `All ${row.histograms.length} histograms with the unit ${row.unit}` : row.histograms.join(", "),
    })),
};
