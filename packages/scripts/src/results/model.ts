/**
 * This module is the pure part of the results collector. It changes the
 * files that the test runs write into the parts of a RunReport. The module
 * does no I/O, so the unit tests can use every function.
 */
import {
    SCHEMA_VERSION,
    summarizeRun,
    type BudgetResult,
    type Measurement,
    type MutationOrigin,
    type RunIndex,
    type RunReport,
    type RunSummary,
    type SuiteKind,
    type SuiteMeta,
    type VitestJsonReport,
} from "@lag/report";

/** One file in a project report: the shape of Vitest's JSON reporter. */
export type ProjectReportFile = VitestJsonReport["testResults"][number];

/** The tests of one Vitest project (one browser instance), from `project-reporter.ts`. */
export type ProjectReport = VitestJsonReport & {
    /** The Vitest project name, for example "browser (firefox)". */
    project : string;
    /** "node", or the browser: "chromium", "firefox", "webkit" or "chrome". */
    environment : string;
};

/**
 * One line of `results.jsonl`, which the browser commands of
 * @lag/integration-tests write. Refer to `src/command-types.ts` in that
 * package.
 */
export type ResultRecord =
    | {
        kind : "measurement";
        project : string;
        environment : string;
        file : string;
        measurement : { name : string; unit : string; values : number[]; labels : Record<string, string> };
    }
    | {
        kind : "budget";
        project : string;
        environment : string;
        file : string;
        budget : BudgetResult;
    };

/**
 * The short name of a workspace package: "@mark1russell7/lag" gives "core" (the name of the
 * package before it went to npm), "@lag/integration-tests" gives "integration".
 */
export function packageSlug(packageName : string) : string {
    if (packageName === "@mark1russell7/lag") return "core";
    const name = packageName.replace(/^@lag\//, "");
    return name === "integration-tests" ? "integration" : name;
}

/** The kind of suite of a Vitest project, from the project name. */
export function suiteKind(project : string, environment : string) : SuiteKind {
    const base = project.replace(/\s*\(.*\)$/, "");
    if (base === "overhead") return "benchmark";
    if (base === "soak") return "soak";
    if (base === "e2e") return "e2e";
    return environment === "node" ? "unit" : "browser";
}

/**
 * The suite of one Vitest project of one package. The ID has the package,
 * the project and the environment, for example "integration-coi-firefox",
 * "core-unit-node" or "site-browser-chromium".
 */
export function suiteMeta(packageName : string, project : string, environment : string) : SuiteMeta {
    const kind = suiteKind(project, environment);
    const base = project.replace(/\s*\(.*\)$/, "").trim();
    // Unit packages have no project name; the site has the projects "node" and "browser"
    const middle = base === "" || base === "node" || base === environment ? (kind === "unit" ? "unit" : kind) : base;
    return {
        id : [packageSlug(packageName), middle, environment].join("-").toLowerCase(),
        packageName,
        kind,
        environment,
    };
}

/** The records of `results.jsonl`. Lines that are not valid records are left out. */
export function parseResultLines(text : string) : ResultRecord[] {
    const records : ResultRecord[] = [];
    for (const line of text.split(/\r?\n/)) {
        if (line.trim() === "") continue;
        try {
            const record = JSON.parse(line) as Partial<ResultRecord>;
            if (record.kind === "measurement" && record.measurement && typeof record.project === "string") records.push(record as ResultRecord);
            if (record.kind === "budget" && record.budget && typeof record.project === "string") records.push(record as ResultRecord);
        } catch {
            // A line that a test wrote when the run stopped
        }
    }
    return records;
}

/**
 * The measurements of a run. Each measurement belongs to the suite of the
 * project that recorded it. Two records with the same name and unit in one
 * suite (for example a retried test) join into one measurement.
 */
export function toMeasurements(records : readonly ResultRecord[], packageName : string) : Measurement[] {
    const byKey = new Map<string, Measurement>();
    for (const record of records) {
        if (record.kind !== "measurement") continue;
        const suiteId = suiteMeta(packageName, record.project, record.environment).id;
        const { name, unit, values, labels } = record.measurement;
        const key = `${suiteId}\u0000${name}\u0000${unit}`;
        const existing = byKey.get(key);
        if (existing) {
            existing.values.push(...values);
        } else {
            byKey.set(key, { suiteId, name, unit, values : [...values], labels : { ...labels } });
        }
    }
    return [...byKey.values()];
}

/** The budgets of a run, one for each name (the last record wins), the failed ones first. */
export function toBudgets(records : readonly ResultRecord[]) : BudgetResult[] {
    const byName = new Map<string, BudgetResult>();
    for (const record of records) {
        if (record.kind !== "budget") continue;
        const { name, unit, value, limit } = record.budget;
        byName.set(name, { name, unit, value, limit, pass : value <= limit });
    }
    return [...byName.values()].sort((a, b) => Number(a.pass) - Number(b.pass) || a.name.localeCompare(b.name));
}

/**
 * The exit code of the collector. It is 1 when a test or a budget failed, or
 * when a step gave an exit code that is not 0. A step can fail without a
 * failed test in the reports, for example when Vitest cannot start.
 */
export function runExitCode(failedTests : number, budgets : readonly BudgetResult[], stepExitCodes : readonly number[]) : 0 | 1 {
    return failedTests > 0 || budgets.some(budget => !budget.pass) || stepExitCodes.some(code => code !== 0) ? 1 : 0;
}

/** The tolerance for file systems that keep the change time in whole seconds. */
const FILE_TIME_TOLERANCE_MS = 2_000;

/**
 * True if a file changed during the run that started at `runStart`. A file
 * from before the run, for example the coverage of an earlier run with
 * `--skip-unit`, is not a result of this run.
 */
export function changedDuringRun(modified : Date, runStart : Date) : boolean {
    return modified.getTime() >= runStart.getTime() - FILE_TIME_TOLERANCE_MS;
}

/** The name of the file next to `mutation.json` with the commit and the time of the Stryker run. */
export const MUTATION_ORIGIN_FILE = "mutation-run.json";

/**
 * The commit and the time of a Stryker report. The Pages workflow writes them
 * into `MUTATION_ORIGIN_FILE` when it downloads the report of the mutation
 * workflow. Without this file, for example after a local `pnpm mutation`, the
 * time is the time of the change to `mutation.json`, and the commit is not
 * known.
 */
export function mutationOrigin(origin : unknown, reportModified : Date) : MutationOrigin {
    const value = typeof origin === "object" && origin !== null ? origin as Record<string, unknown> : {};
    const commit = typeof value["commit"] === "string" && value["commit"] !== "" ? value["commit"] : undefined;
    const createdAt = typeof value["createdAt"] === "string" && !Number.isNaN(Date.parse(value["createdAt"]))
        ? new Date(value["createdAt"]).toISOString()
        : reportModified.toISOString();
    return { ...(commit !== undefined ? { commit } : {}), createdAt };
}

/** A run ID that sorts by time and shows the commit: "2026-10-07-153012-b492a0a". */
export function runId(createdAt : Date, commit? : string) : string {
    const iso = createdAt.toISOString();
    const time = `${iso.slice(0, 10)}-${iso.slice(11, 19).replace(/:/g, "")}`;
    return commit ? `${time}-${commit.slice(0, 7)}` : time;
}

/** The file name of a run, relative to the index. */
export function runFile(id : string) : string {
    return `runs/${id}.json`;
}

/**
 * This function adds a run to the index. An index with another schema
 * version, or a value that is not an index, starts again empty: the site
 * cannot read its runs.
 */
export function mergeIndex(existing : unknown, run : RunReport, maxRuns = 50) : RunIndex {
    const previous = isRunIndex(existing) ? existing.runs.filter(summary => summary.id !== run.id) : [];
    const runs : RunSummary[] = [...previous, summarizeRun(run, runFile(run.id))]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .slice(-maxRuns);
    return { schemaVersion : SCHEMA_VERSION, runs };
}

function isRunIndex(value : unknown) : value is RunIndex {
    return typeof value === "object" && value !== null
        && (value as RunIndex).schemaVersion === SCHEMA_VERSION
        && Array.isArray((value as RunIndex).runs);
}
