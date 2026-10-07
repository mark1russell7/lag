/**
 * Sample test results: two runs with suites in Node, Chromium, Firefox and
 * WebKit, coverage, mutation scores, measurements and budgets. The values are
 * made with a seeded random generator, so they are the same each time.
 *
 * The site uses this data in tests and in the "Show sample data" switch,
 * which shows only in development. These are not real results.
 */
import {
    SCHEMA_VERSION,
    type BudgetResult,
    type CoverageReport,
    type Measurement,
    type MutationReport,
    type RunReport,
    type SuiteKind,
    type SuiteResult,
    type TestStatus,
} from "../adapters/lag-report";
import { MemoryReportSource } from "../results/report-source";

/** mulberry32: a small seeded generator. */
function createRandom(seed : number) : () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function normal(random : () => number) : number {
    const u = Math.max(random(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

const round = (value : number, digits = 1) : number => Number(value.toFixed(digits));

type FileSpec = { file : string; describe : string; tests : readonly string[] };

const CORE_FILES : readonly FileSpec[] = [
    { file : "packages/lag/src/DriftLag.test.ts", describe : "DriftLag", tests : [
        "reports the lag of a blocked window",
        "chains 5 ms timeouts across the window",
        "stops every timer on stop()",
        "discards a window that overlaps a hidden period",
    ] },
    { file : "packages/lag/src/MacrotaskLag.test.ts", describe : "MacrotaskLag", tests : [
        "measures the delay of setTimeout(0)",
        "samples every 5 s",
        "pauses while the page is hidden",
    ] },
    { file : "packages/lag/src/LifecycleStateMachine.test.ts", describe : "LifecycleStateMachine", tests : [
        "starts hidden when the document is hidden",
        "moves from active to passive on blur",
        "moves to frozen on a persisted pagehide",
        "returns the transitions after a mark",
        "reads visibilityState again on each read",
    ] },
    { file : "packages/lag/src/EventTimingMonitor.test.ts", describe : "EventTimingMonitor", tests : [
        "reports INP as the worst interaction",
        "splits an event into its phases",
        "ignores events under 16 ms",
    ] },
    { file : "packages/lag/src/GCSignalDetector.test.ts", describe : "GCSignalDetector", tests : [
        "counts a collection when the canary is finalized",
        "reports the recent rate",
    ] },
    { file : "packages/lag/src/WorkerLagMonitor.test.ts", describe : "WorkerLagMonitor", tests : [
        "measures the delivery delay of each heartbeat",
        "detects a missing heartbeat",
        "stops the worker loop on stop()",
    ] },
    { file : "packages/lag/src/FrameTimingMonitor.test.ts", describe : "FrameTimingMonitor", tests : [
        "records the delta between frames",
        "counts dropped frames at 60 Hz",
    ] },
    { file : "packages/lag/src/setup-all-monitors.test.ts", describe : "setupAllMonitors", tests : [
        "registers a monitor for each capability",
        "skips the worker monitor without performance",
        "releases every timer on stop()",
        "stops the monitors in reverse order",
    ] },
];

const LOAD_FILES : readonly FileSpec[] = [
    { file : "packages/load/src/load.test.ts", describe : "load", tests : [
        "makes the same numbers for the same seed",
        "clamps samples to the bounds",
        "samples a power law above xMin",
        "runs a workload until the duration ends",
    ] },
];

const REPORT_FILES : readonly FileSpec[] = [
    { file : "packages/report/src/convert.test.ts", describe : "convert", tests : [
        "converts a Vitest JSON report",
        "converts an Istanbul summary",
        "converts a Stryker report",
        "counts the statuses of a run",
    ] },
];

const BROWSER_FILES : readonly FileSpec[] = [
    { file : "packages/lag-integration-tests/src/lag-monitors.test.ts", describe : "Lag monitors in a real browser", tests : [
        "records drift after a 200 ms block",
        "records long animation frames",
        "records event timing for a click",
        "records frame deltas",
        "pauses while the tab is hidden",
    ] },
    { file : "packages/lag-integration-tests/src/worker.test.ts", describe : "Worker Lag Monitor Integration", tests : [
        "receives heartbeats from a real Web Worker",
        "detects main thread blocking",
        "stops and restarts the worker's heartbeat loop",
    ] },
];

const STRESS_FILES : readonly FileSpec[] = [
    { file : "packages/lag-integration-tests/src/stress.test.ts", describe : "Stress profiles", tests : [
        "light profile",
        "moderate profile",
        "heavy profile",
    ] },
];

const SITE_FILES : readonly FileSpec[] = [
    { file : "packages/site/src/app/smoke.browser.test.tsx", describe : "Site routes", tests : [
        "renders the home page",
        "renders every content page",
        "renders the results viewer",
        "renders the playground",
    ] },
];

type Outcome = { status : TestStatus; message? : string };

type SuiteSpec = {
    id : string;
    packageName : string;
    kind : SuiteKind;
    environment : string;
    files : readonly FileSpec[];
    /** Typical test duration, in ms. */
    durationMs : number;
    /** Outcomes that are not "passed", by test name. */
    outcomes? : Readonly<Record<string, Outcome>>;
};

function makeSuite(spec : SuiteSpec, startedAt : string, random : () => number) : SuiteResult {
    let total = 0;
    const files = spec.files.map(file => ({
        file : file.file,
        tests : file.tests.map(name => {
            const outcome = spec.outcomes?.[name] ?? { status : "passed" as const };
            const ran = outcome.status === "passed" || outcome.status === "failed";
            const durationMs = ran ? round(spec.durationMs * Math.exp(0.8 * normal(random)), 2) : 0;
            total += durationMs;
            return {
                name,
                path : [file.describe, name],
                status : outcome.status,
                durationMs,
                failureMessages : outcome.message ? [outcome.message] : [],
            };
        }),
    }));
    return {
        id : spec.id,
        packageName : spec.packageName,
        kind : spec.kind,
        environment : spec.environment,
        startedAt,
        durationMs : round(total + 300 + 400 * random(), 0),
        files,
    };
}

const SKIP_LOAF : Readonly<Record<string, Outcome>> = {
    "records long animation frames" : { status : "skipped" },
};

function browserSuites(failures : Readonly<Record<string, Readonly<Record<string, Outcome>>>>) : SuiteSpec[] {
    return (["chromium", "firefox", "webkit"] as const).map(environment => ({
        id : `integration-browser-${environment}`,
        packageName : "@lag/integration-tests",
        kind : "browser" as const,
        environment,
        files : BROWSER_FILES,
        durationMs : 900,
        outcomes : { ...(environment === "chromium" ? {} : SKIP_LOAF), ...(failures[environment] ?? {}) },
    }));
}

function coverageFile(file : string, lines : number, ratio : number, random : () => number) : CoverageReport["files"][number] {
    const covered = (total : number, spread : number) : number =>
        Math.min(total, Math.max(0, Math.round(total * (ratio + spread * (random() - 0.5)))));
    const statements = Math.round(lines * 1.15);
    const functions = Math.max(2, Math.round(lines / 9));
    const branches = Math.max(2, Math.round(lines / 4));
    return {
        file,
        lines : { covered : covered(lines, 0.04), total : lines },
        statements : { covered : covered(statements, 0.05), total : statements },
        functions : { covered : covered(functions, 0.1), total : functions },
        branches : { covered : covered(branches, 0.16), total : branches },
    };
}

function coverageReport(packageName : string, files : ReadonlyArray<[string, number, number]>, random : () => number) : CoverageReport {
    const fileCoverage = files.map(([file, lines, ratio]) => coverageFile(file, lines, ratio, random));
    const sum = (key : "lines" | "statements" | "functions" | "branches") => fileCoverage.reduce(
        (total, file) => ({ covered : total.covered + file[key].covered, total : total.total + file[key].total }),
        { covered : 0, total : 0 },
    );
    return {
        packageName,
        total : { lines : sum("lines"), statements : sum("statements"), functions : sum("functions"), branches : sum("branches") },
        files : fileCoverage,
    };
}

function coverage(random : () => number, shift : number) : CoverageReport[] {
    const core : Array<[string, number, number]> = [
        ["packages/lag/src/DriftLag.ts", 64, 0.97],
        ["packages/lag/src/MacrotaskLag.ts", 52, 0.94],
        ["packages/lag/src/LifecycleStateMachine.ts", 168, 0.92],
        ["packages/lag/src/EventTimingMonitor.ts", 120, 0.88],
        ["packages/lag/src/LongAnimationFrameMonitor.ts", 58, 0.9],
        ["packages/lag/src/LayoutShiftMonitor.ts", 61, 0.86],
        ["packages/lag/src/FrameTimingMonitor.ts", 74, 0.91],
        ["packages/lag/src/IdleAvailabilityMonitor.ts", 66, 0.83],
        ["packages/lag/src/SchedulingFairnessMonitor.ts", 70, 0.8],
        ["packages/lag/src/MemoryMonitor.ts", 81, 0.78],
        ["packages/lag/src/ComputePressureMonitor.ts", 72, 0.69],
        ["packages/lag/src/GCSignalDetector.ts", 88, 0.84],
        ["packages/lag/src/TimerThrottleDetector.ts", 79, 0.81],
        ["packages/lag/src/ClockReliabilityChecker.ts", 63, 0.87],
        ["packages/lag/src/WorkerLagMonitor.ts", 92, 0.89],
        ["packages/lag/src/setup-all-monitors.ts", 98, 0.96],
    ];
    const load : Array<[string, number, number]> = [
        ["packages/load/src/rng.ts", 30, 1],
        ["packages/load/src/distributions.ts", 72, 0.93],
        ["packages/load/src/generators.ts", 110, 0.58],
        ["packages/load/src/workload.ts", 61, 0.9],
        ["packages/load/src/profiles.ts", 95, 0.74],
    ];
    const report : Array<[string, number, number]> = [
        ["packages/report/src/convert.ts", 120, 0.95],
        ["packages/report/src/schema.ts", 4, 1],
    ];
    const adjust = (files : Array<[string, number, number]>) : Array<[string, number, number]> =>
        files.map(([file, lines, ratio]) => [file, lines, Math.min(1, ratio + shift)]);
    return [
        coverageReport("@lag/core", adjust(core), random),
        coverageReport("@lag/load", adjust(load), random),
        coverageReport("@lag/report", adjust(report), random),
    ];
}

function mutation(random : () => number) : MutationReport[] {
    const files = [
        "packages/lag/src/DriftLag.ts",
        "packages/lag/src/MacrotaskLag.ts",
        "packages/lag/src/LifecycleStateMachine.ts",
        "packages/lag/src/EventTimingMonitor.ts",
        "packages/lag/src/FrameTimingMonitor.ts",
        "packages/lag/src/GCSignalDetector.ts",
        "packages/lag/src/TimerThrottleDetector.ts",
        "packages/lag/src/WorkerLagMonitor.ts",
        "packages/lag/src/MemoryMonitor.ts",
        "packages/lag/src/ComputePressureMonitor.ts",
    ].map((file, index) => {
        const total = 20 + Math.round(random() * 60);
        const survived = Math.round(total * (0.04 + 0.03 * index * random()));
        const noCoverage = index % 4 === 3 ? Math.round(total * 0.08) : 0;
        const timeout = Math.round(random() * 2);
        const killed = Math.max(0, total - survived - noCoverage - timeout);
        const valid = killed + survived + noCoverage + timeout;
        return {
            file,
            counts : { Killed : killed, Survived : survived, NoCoverage : noCoverage, Timeout : timeout, Ignored : index % 3 },
            score : round(((killed + timeout) / valid) * 100, 2),
        };
    });
    const sum = files.reduce((acc, file) => ({
        detected : acc.detected + (file.counts.Killed ?? 0) + (file.counts.Timeout ?? 0),
        valid : acc.valid + (file.counts.Killed ?? 0) + (file.counts.Timeout ?? 0) + (file.counts.Survived ?? 0) + (file.counts.NoCoverage ?? 0),
    }), { detected : 0, valid : 0 });
    return [{ packageName : "@lag/core", score : round((sum.detected / sum.valid) * 100, 2), files }];
}

/** Values with a long tail: a log-normal body and some large spikes. */
function lagValues(random : () => number, count : number, median : number, spread : number, spikeRate : number) : number[] {
    return Array.from({ length : count }, () => {
        const body = median * Math.exp(spread * normal(random));
        const spike = random() < spikeRate ? median * (4 + 12 * random()) : 0;
        return round(Math.max(0, body + spike), 2);
    });
}

const PROFILE_SHAPES = {
    light : { drift : [1.2, 0.5, 0.01], worker : [0.8, 0.6, 0.01], frame : [16.8, 0.06, 0.01] },
    moderate : { drift : [6, 0.7, 0.04], worker : [4, 0.8, 0.04], frame : [17.5, 0.18, 0.05] },
    heavy : { drift : [28, 0.8, 0.08], worker : [22, 0.9, 0.08], frame : [24, 0.35, 0.12] },
} as const;

function measurements(random : () => number, scale : number) : Measurement[] {
    const result : Measurement[] = [];
    for (const [profile, shapes] of Object.entries(PROFILE_SHAPES)) {
        const metrics : Array<[string, readonly [number, number, number]]> = [
            ["lag_drift_histogram", shapes.drift],
            ["lag_worker_main_block_histogram", shapes.worker],
            ["lag_frame_delta_histogram", shapes.frame],
        ];
        for (const [metric, [median, spread, spikes]] of metrics) {
            result.push({
                suiteId : "stress-benchmark-chromium",
                name : `stress/${profile}/${metric}`,
                unit : "ms",
                values : lagValues(random, 240, median * scale, spread, spikes),
                labels : { profile, browser : "chromium" },
            });
        }
    }
    for (const [browser, factor] of [["firefox", 1.25], ["webkit", 1.4]] as const) {
        result.push({
            suiteId : `integration-browser-${browser}`,
            name : `stress/moderate/lag_drift_histogram`,
            unit : "ms",
            values : lagValues(random, 200, 6 * factor * scale, 0.75, 0.05),
            labels : { profile : "moderate", browser },
        });
    }
    return result;
}

function budgets(workerP99 : number, driftOverhead : number) : BudgetResult[] {
    const budget = (name : string, unit : string, value : number, limit : number) : BudgetResult =>
        ({ name, unit, value, limit, pass : value <= limit });
    return [
        budget("DriftLag CPU overhead", "%", driftOverhead, 2),
        budget("Bundle size of @lag/core (gzip)", "kB", 18.4, 20),
        budget("p95 drift, light profile", "ms", 6.2, 10),
        budget("p99 worker heartbeat delay, idle page", "ms", workerP99, 20),
    ];
}

function makeRun(options : {
    id : string;
    createdAt : string;
    commit : string;
    branch : string;
    seed : number;
    coreOutcomes : Readonly<Record<string, Outcome>>;
    browserFailures : Readonly<Record<string, Readonly<Record<string, Outcome>>>>;
    coverageShift : number;
    measurementScale : number;
    workerP99 : number;
    driftOverhead : number;
}) : RunReport {
    const random = createRandom(options.seed);
    const specs : SuiteSpec[] = [
        { id : "core-unit-node", packageName : "@lag/core", kind : "unit", environment : "node", files : CORE_FILES, durationMs : 6, outcomes : options.coreOutcomes },
        { id : "load-unit-node", packageName : "@lag/load", kind : "unit", environment : "node", files : LOAD_FILES, durationMs : 9 },
        { id : "report-unit-node", packageName : "@lag/report", kind : "unit", environment : "node", files : REPORT_FILES, durationMs : 3 },
        ...browserSuites(options.browserFailures),
        { id : "stress-benchmark-chromium", packageName : "@lag/integration-tests", kind : "benchmark", environment : "chromium", files : STRESS_FILES, durationMs : 15_000 },
        { id : "site-browser-chromium", packageName : "@lag/site", kind : "browser", environment : "chromium", files : SITE_FILES, durationMs : 1_400 },
    ];
    return {
        schemaVersion : SCHEMA_VERSION,
        id : options.id,
        createdAt : options.createdAt,
        git : { commit : options.commit, branch : options.branch },
        suites : specs.map(spec => makeSuite(spec, options.createdAt, random)),
        coverage : coverage(random, options.coverageShift),
        mutation : mutation(random),
        measurements : measurements(random, options.measurementScale),
        budgets : budgets(options.workerP99, options.driftOverhead),
    };
}

const FIRST_RUN = makeRun({
    id : "2026-10-05-a1b2c3d",
    createdAt : "2026-10-05T14:12:09.000Z",
    commit : "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678",
    branch : "main",
    seed : 20261005,
    coreOutcomes : {},
    browserFailures : {
        webkit : {
            "detects main thread blocking" : {
                status : "failed",
                message : "AssertionError: expected 512.4 to be greater than 600\n    at packages/lag-integration-tests/src/worker.test.ts:55:41",
            },
        },
    },
    coverageShift : -0.02,
    measurementScale : 1,
    workerP99 : 17.1,
    driftOverhead : 1.6,
});

const SECOND_RUN = makeRun({
    id : "2026-10-06-f6e5d4c",
    createdAt : "2026-10-06T09:41:33.000Z",
    commit : "f6e5d4c3b2a1908172635445362718090a1b2c3d",
    branch : "feat/full-program",
    seed : 20261006,
    coreOutcomes : {
        "discards a window that overlaps a hidden period" : {
            status : "failed",
            message : "AssertionError: expected [ 12.4 ] to deeply equal []\n\n- Expected\n+ Received\n\n- []\n+ [\n+   12.4,\n+ ]\n    at packages/lag/src/DriftLag.test.ts:88:31",
        },
        "samples every 5 s" : { status : "todo" },
    },
    browserFailures : {
        firefox : {
            "pauses while the tab is hidden" : {
                status : "failed",
                message : "AssertionError: expected 3 to be +0 // Object.is equality\n    at packages/lag-integration-tests/src/lag-monitors.test.ts:141:29",
            },
        },
        webkit : {
            "detects main thread blocking" : {
                status : "failed",
                message : "AssertionError: expected 412.5 to be greater than 600\n    at packages/lag-integration-tests/src/worker.test.ts:55:41",
            },
        },
    },
    coverageShift : 0,
    measurementScale : 0.92,
    workerP99 : 24.8,
    driftOverhead : 1.4,
});

/** The sample runs, the newest last, with the file names that the index uses. */
export const SAMPLE_RUNS : ReadonlyArray<{ file : string; report : RunReport }> = [
    { file : "runs/2026-10-05-a1b2c3d.json", report : FIRST_RUN },
    { file : "runs/2026-10-06-f6e5d4c.json", report : SECOND_RUN },
];

export function createSampleReportSource() : MemoryReportSource {
    return MemoryReportSource.fromRuns(SAMPLE_RUNS);
}
