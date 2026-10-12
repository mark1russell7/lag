/**
 * The summary of the runs of E8. For each engine and setup, it gives the
 * median and the range of the rounds. Each round measures all setups one
 * after the other, thus the runner also compares each setup with setup A of
 * the same round. The module does no I/O.
 */
import { CORRECTNESS_CASES, SETUP_IDS, type CorrectnessCase, type CorrectnessResult, type LoafScript, type SetupFacts, type SetupId } from "../shared/types.js";
import { spread, type Spread } from "./stats.js";

export const ENGINES = ["chromium", "firefox", "webkit"] as const;
export type Engine = (typeof ENGINES)[number];

/** The result of one page run: one setup in one engine in one round. */
export type RunResult = {
    engine : Engine;
    round : number;
    /** The position of the setup in the order of its round, from 0. */
    position : number;
    /** The end of the run (ISO 8601, UTC). */
    measuredAt : string;
    setup : SetupId;
    facts : SetupFacts;
    /** The values of the run, for example `"workload.fetch.totalMs"`. A metric that the engine cannot measure is absent. */
    metrics : Record<string, number>;
    /** The longest script of each long animation frame of the fixed blocking tasks. */
    loafScripts : LoafScript[];
    correctness : CorrectnessResult;
    /** The requests to the OTLP path of the runner. The page sends no telemetry, thus 0. */
    otlpRequests : number;
    /** The errors of the page and the error messages of its console. */
    errors : string[];
};

/** The result of a context case in all rounds: the same result in each round, or "varies". */
export type CaseResult = boolean | "varies";

export type SetupSummary = {
    /** The median and the range of each metric over the rounds. */
    metrics : Record<string, Spread>;
    /** The value divided by the value of setup A of the same round. */
    factorsVsA : Record<string, Spread>;
    /** The value minus the value of setup A of the same round. */
    differencesVsA : Record<string, Spread>;
    correctness : Record<CorrectnessCase, CaseResult>;
    /** The different descriptions of the longest script of a blocking task: "invoker / function name". */
    loafScripts : string[];
    rounds : number;
};

export type EngineSummary = Partial<Record<SetupId, SetupSummary>>;

function metricNames(runs : readonly RunResult[]) : string[] {
    return [...new Set(runs.flatMap(run => Object.keys(run.metrics)))].sort();
}

/** The values of `name` over the rounds, against the value of the baseline run of the same round. */
function compared(runs : readonly RunResult[], baselines : ReadonlyMap<number, RunResult>, name : string, combine : (value : number, base : number) => number) : number[] {
    return runs.flatMap((run) => {
        const value = run.metrics[name];
        const base = baselines.get(run.round)?.metrics[name];
        return value === undefined || base === undefined ? [] : [combine(value, base)];
    });
}

function caseResult(results : readonly boolean[]) : CaseResult {
    if (results.every(Boolean)) return true;
    if (results.every(result => !result)) return false;
    return "varies";
}

/** This function describes a script of a long animation frame in a short form. */
export function describeScript(script : LoafScript) : string {
    return `${script.invoker || "(no invoker)"} / ${script.sourceFunctionName || "(no function name)"}`;
}

function summarizeSetup(runs : readonly RunResult[], baselines : ReadonlyMap<number, RunResult>) : SetupSummary {
    const names = metricNames(runs);
    const metrics : Record<string, Spread> = {};
    const factorsVsA : Record<string, Spread> = {};
    const differencesVsA : Record<string, Spread> = {};
    for (const name of names) {
        metrics[name] = spread(runs.flatMap(run => run.metrics[name] === undefined ? [] : [run.metrics[name]]));
        factorsVsA[name] = spread(compared(runs, baselines, name, (value, base) => (base === 0 ? Number.NaN : value / base)));
        differencesVsA[name] = spread(compared(runs, baselines, name, (value, base) => value - base));
    }
    const correctness = Object.fromEntries(CORRECTNESS_CASES.map(name => [name, caseResult(runs.map(run => run.correctness[name]))])) as Record<CorrectnessCase, CaseResult>;
    const loafScripts = [...new Set(runs.flatMap(run => run.loafScripts.map(describeScript)))].sort();
    return { metrics, factorsVsA, differencesVsA, correctness, loafScripts, rounds : runs.length };
}

/** The size of the JavaScript of one minified build, in bytes. gzip uses the default level of zlib (6). */
export type BundleSize = {
    setup : SetupId;
    /** The JavaScript of the page, without the worker of lag. */
    pageBytes : number;
    pageGzipBytes : number;
    /** The worker of lag. It is the same in each setup, because the plugins of the page do not change the worker. */
    workerBytes : number;
    workerGzipBytes : number;
    /** True if the JavaScript of the page contains zone.js. */
    containsZone : boolean;
    /** True if the JavaScript of the page contains the runtime of async-browser-context. */
    containsAsyncContext : boolean;
};

/** The file that the runner writes. */
export type E8Results = {
    experiment : "E8";
    title : string;
    quick : boolean;
    /** The end of the first page run and of the last page run (ISO 8601, UTC). With `--resume`, the page runs can come from more than one invocation. */
    measured : { first : string; last : string };
    machine : Record<string, string | number>;
    packages : Record<string, string>;
    browsers : Partial<Record<Engine, string>>;
    timing : Record<string, number>;
    rounds : number;
    /** The runs that the runner took from the file of `--resume`, without a new measurement. */
    resumedRuns : number;
    setups : Array<{ id : SetupId; label : string }>;
    facts : Partial<Record<Engine, Partial<Record<SetupId, SetupFacts>>>>;
    bundles : BundleSize[];
    summary : Partial<Record<Engine, EngineSummary>>;
    runs : RunResult[];
};

/** This function summarizes the runs of each engine and setup. */
export function summarize(runs : readonly RunResult[]) : Partial<Record<Engine, EngineSummary>> {
    const summary : Partial<Record<Engine, EngineSummary>> = {};
    for (const engine of ENGINES) {
        const ofEngine = runs.filter(run => run.engine === engine);
        if (ofEngine.length === 0) continue;
        const baselines = new Map(ofEngine.filter(run => run.setup === "A").map(run => [run.round, run]));
        const engineSummary : EngineSummary = {};
        for (const setup of SETUP_IDS) {
            const ofSetup = ofEngine.filter(run => run.setup === setup);
            if (ofSetup.length > 0) engineSummary[setup] = summarizeSetup(ofSetup, baselines);
        }
        summary[engine] = engineSummary;
    }
    return summary;
}
