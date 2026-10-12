/**
 * The Markdown tables of the results of E8, for the page "Local
 * experiments". The runner prints them at the end of a run, and
 * `pnpm --filter @lag/experiments e8:tables` prints them from a results
 * file. A cell gives the median of the rounds and, in parentheses, the
 * lowest and the highest round. The module does no I/O.
 */
import { CORRECTNESS_CASES, SETUP_IDS, WORKLOAD_NAMES, type CorrectnessCase, type SetupId } from "../shared/types.js";
import type { Spread } from "./stats.js";
import { ENGINES, type CaseResult, type E8Results, type Engine, type EngineSummary } from "./summary.js";

export const ENGINE_LABELS : Readonly<Record<Engine, string>> = { chromium : "Chromium", firefox : "Firefox", webkit : "WebKit" };

export const CASE_LABELS : Readonly<Record<CorrectnessCase, string>> = {
    "sync" : "Synchronous code (control)",
    "promise-then" : "`Promise.then` callback",
    "await" : "After `await`",
    "set-timeout" : "`setTimeout` callback",
    "listener-browser-dispatch" : "Event listener, the browser dispatches the event (`message`)",
    "listener-code-dispatch" : "Event listener, a dispatch in the root context (C13: the context of the registration)",
    "fetch-then" : "`fetch().then()` callback",
    "await-fetch" : "After `await fetch()`",
    "no-leak" : "No active span after the cases (control)",
};

/** The readings of the lag monitors: the metric of the run and its label. */
const READINGS : ReadonlyArray<[string, string]> = [
    ["drift.medianMs", "DriftLag, idle median (ms)"],
    ["drift.p95Ms", "DriftLag, idle p95 (ms)"],
    ["macrotaskLag.medianMs", "MacrotaskLag, median (ms)"],
    ["scheduling.microtask.medianMs", "SchedulingFairness, microtask, median (ms)"],
    ["scheduling.macrotask.medianMs", "SchedulingFairness, `setTimeout(0)`, median (ms)"],
    ["scheduling.messageChannel.medianMs", "SchedulingFairness, message, median (ms)"],
    ["click.lagInpMs", "INP of lag, 5 clicks with a 100 ms handler (ms)"],
    ["click.interaction.medianMs", "Duration of one click interaction, median (ms)"],
    ["loaf.blocking.medianMs", "LoAF blocking of a 150 ms task, median (ms)"],
];

function fixed(value : number, digits : number) : string {
    return value.toFixed(digits);
}

/** A cell: "median (lowest to highest)", or "–" without values. */
export function spreadCell(spread : Spread | undefined, digits = 1, prefix = "") : string {
    if (!spread || spread.n === 0) return "–";
    const median = `${prefix}${fixed(spread.median, digits)}`;
    if (spread.n === 1 || fixed(spread.min, digits) === fixed(spread.max, digits)) return median;
    return `${median} (${fixed(spread.min, digits)} to ${fixed(spread.max, digits)})`;
}

function caseCell(result : CaseResult | undefined) : string {
    if (result === undefined) return "–";
    if (result === "varies") return "Varies";
    return result ? "Yes" : "No";
}

function table(header : readonly string[], rows : ReadonlyArray<readonly string[]>) : string {
    const line = (cells : readonly string[]) : string => `| ${cells.join(" | ")} |`;
    return [line(header), line(header.map(() => "---")), ...rows.map(line)].join("\n");
}

function setupsOf(summary : EngineSummary) : SetupId[] {
    return SETUP_IDS.filter(setup => summary[setup] !== undefined);
}

function idleTable(summary : EngineSummary) : string {
    const rows = setupsOf(summary).map(setup => {
        const s = summary[setup]!;
        return [
            setup,
            spreadCell(s.metrics["idle.setup.taskMsPerS"]),
            spreadCell(s.metrics["idle.monitors.taskMsPerS"]),
            spreadCell(s.metrics["idle.monitors.scriptMsPerS"]),
            setup === "A" ? "–" : spreadCell(s.differencesVsA["idle.monitors.taskMsPerS"], 1, "+"),
        ];
    });
    return table(["Setup", "Setup alone: task time (ms/s)", "With the monitors: task time (ms/s)", "With the monitors: script time (ms/s)", "With the monitors: task time, difference to A (ms/s)"], rows);
}

function workloadTable(summary : EngineSummary, metric : "totalMs" | "taskMs") : string {
    const setups = setupsOf(summary).filter(setup => setup !== "A");
    const rows = WORKLOAD_NAMES.map(name => [
        `\`${name}\``,
        spreadCell(summary.A?.metrics[`workload.${name}.${metric}`]),
        ...setups.map(setup => spreadCell(summary[setup]?.factorsVsA[`workload.${name}.${metric}`], 2, "×")),
    ]);
    return table(["Workload", "A (ms)", ...setups.map(setup => `${setup} / A`)], rows);
}

function readingsTable(summary : EngineSummary) : string {
    const setups = setupsOf(summary);
    const rows = READINGS
        .filter(([metric]) => setups.some(setup => (summary[setup]?.metrics[metric]?.n ?? 0) > 0))
        .map(([metric, label]) => [label, ...setups.map(setup => spreadCell(summary[setup]?.metrics[metric]))]);
    return table(["Reading", ...setups], rows);
}

function correctnessTable(results : E8Results) : string {
    const engines = ENGINES.filter(engine => results.summary[engine] !== undefined);
    const header = ["Case", ...SETUP_IDS.flatMap(setup => engines.map(engine => (engines.length === 1 ? setup : `${setup}, ${ENGINE_LABELS[engine]}`)))];
    // One column for each setup if all engines agree
    const agree = SETUP_IDS.every(setup => CORRECTNESS_CASES.every(name =>
        new Set(engines.map(engine => results.summary[engine]?.[setup]?.correctness[name])).size <= 1));
    if (agree) {
        return table(["Case", ...SETUP_IDS], CORRECTNESS_CASES.map(name => [
            CASE_LABELS[name],
            ...SETUP_IDS.map(setup => caseCell(engines.map(engine => results.summary[engine]?.[setup]?.correctness[name]).find(value => value !== undefined))),
        ]));
    }
    return table(header, CORRECTNESS_CASES.map(name => [
        CASE_LABELS[name],
        ...SETUP_IDS.flatMap(setup => engines.map(engine => caseCell(results.summary[engine]?.[setup]?.correctness[name]))),
    ]));
}

function bundleTable(results : E8Results) : string {
    const base = results.bundles.find(bundle => bundle.setup === "A");
    const kib = (bytes : number) : string => (bytes / 1024).toFixed(1);
    return table(["Setup", "JavaScript of the page (KiB)", "gzip (KiB)", "gzip, difference to A (KiB)", "Contains zone.js", "Contains async-browser-context"], results.bundles.map(bundle => [
        bundle.setup,
        kib(bundle.pageBytes),
        kib(bundle.pageGzipBytes),
        base && bundle.setup !== "A" ? `+${kib(bundle.pageGzipBytes - base.pageGzipBytes)}` : "–",
        bundle.containsZone ? "Yes" : "No",
        bundle.containsAsyncContext ? "Yes" : "No",
    ]));
}

function loafTable(summary : EngineSummary) : string {
    return table(["Setup", "Longest script of the frame: invoker / function name"], setupsOf(summary).map(setup => [
        setup,
        summary[setup]!.loafScripts.join("; ") || "–",
    ]));
}

function loadTable(results : E8Results) : string {
    const engines = ENGINES.filter(engine => results.summary[engine] !== undefined);
    return table(["Engine", ...SETUP_IDS], engines.map(engine => [
        ENGINE_LABELS[engine],
        ...SETUP_IDS.map(setup => spreadCell(results.summary[engine]?.[setup]?.metrics["machine.cpuBusyPercent"], 0)),
    ]));
}

/** This function gives all tables of a results file as Markdown. */
export function renderTables(results : E8Results) : string {
    const parts : string[] = [];
    const add = (title : string, body : string) : void => {
        parts.push(`### ${title}\n\n${body}\n`);
    };
    const chromium = results.summary.chromium;
    if (chromium) add("Idle cost, Chromium (CDP)", idleTable(chromium));
    for (const engine of ENGINES) {
        const summary = results.summary[engine];
        if (!summary) continue;
        add(`Workloads, total time, ${ENGINE_LABELS[engine]}`, workloadTable(summary, "totalMs"));
        if (engine === "chromium") add("Workloads, main-thread time, Chromium (CDP)", workloadTable(summary, "taskMs"));
        add(`Readings of the monitors, ${ENGINE_LABELS[engine]}`, readingsTable(summary));
    }
    if (chromium) add("Long animation frames of the 150 ms task, Chromium", loafTable(chromium));
    add("Active span after asynchronous work", correctnessTable(results));
    add("Bundle size (minified)", bundleTable(results));
    add("CPU load of the machine during the runs (%)", loadTable(results));
    return parts.join("\n");
}
