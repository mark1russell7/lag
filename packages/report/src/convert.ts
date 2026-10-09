/**
 * Pure converters from tool output formats to the report schema. They do no
 * I/O, so the collector and the tests can use them in any runtime.
 */

import type {
    BudgetCounts,
    BudgetResult,
    CoverageCounts,
    CoverageReport,
    FileCoverage,
    MutantStatus,
    MutationFile,
    MutationReport,
    RunReport,
    RunSummary,
    StatusCounts,
    SuiteResult,
    TestCaseResult,
    TestFileResult,
    TestStatus,
} from "./schema.js";

/** The parts of Vitest's JSON reporter output that the converter reads. */
export type VitestJsonReport = {
    startTime? : number;
    testResults : Array<{
        name : string;
        startTime? : number;
        endTime? : number;
        /** "failed" also for an error outside the tests, for example in a hook or at the import of the file. */
        status? : string;
        /** The first error of the file outside its tests, or "". */
        message? : string;
        assertionResults : Array<{
            title : string;
            ancestorTitles? : string[];
            status : string;
            duration? : number | null;
            failureMessages? : string[];
        }>;
    }>;
};

export type SuiteMeta = Pick<SuiteResult, "id" | "packageName" | "kind" | "environment">;

const STATUS_MAP : Record<string, TestStatus> = {
    passed : "passed",
    failed : "failed",
    skipped : "skipped",
    pending : "skipped",
    todo : "todo",
    disabled : "skipped",
};

/**
 * The checkout folder of a GitHub runner: `/home/runner/work/<repo>/<repo>/`
 * (Linux), `/Users/runner/work/<repo>/<repo>/` (macOS) or `D:/a/<repo>/<repo>/`
 * (Windows).
 */
const RUNNER_CHECKOUT = /^(?:\/home\/runner\/work|\/Users\/runner\/work|[A-Za-z]:\/a)\/([^/]+)\/\1\//;

/**
 * This function makes `file` relative to `rootDir`, with forward slashes. A
 * report of another machine has a different root, for example the Safari
 * reports of the macOS job in the Linux job. For such a file, the function
 * removes the checkout folder of the runner, or else the part before the
 * `packages/` folder of the repository. Thus a file has the same name in
 * each engine.
 */
export function relativePath(file : string, rootDir : string) : string {
    const normalize = (p : string) : string => p.replace(/\\/g, "/");
    const root = normalize(rootDir).replace(/\/$/, "");
    const path = normalize(file);
    if (path.toLowerCase().startsWith(root.toLowerCase() + "/")) return path.slice(root.length + 1);
    const checkout = RUNNER_CHECKOUT.exec(path);
    if (checkout) return path.slice(checkout[0].length);
    const packages = path.indexOf("/packages/");
    return packages >= 0 ? path.slice(packages + 1) : path;
}

/**
 * The name of a failed test that stands for the errors of a file or a suite
 * outside its tests. For example, a hook failed, or the import of the file
 * failed. Such an error has no failed test of its own.
 */
export const ERRORS_OUTSIDE_TESTS = "Errors outside the tests";

export function fromVitestJson(report : VitestJsonReport, meta : SuiteMeta, rootDir : string) : SuiteResult {
    const files : TestFileResult[] = report.testResults.map((file) => {
        const tests = file.assertionResults.map((test) : TestCaseResult => ({
            name : test.title,
            path : [...(test.ancestorTitles ?? []), test.title],
            status : STATUS_MAP[test.status] ?? "failed",
            durationMs : test.duration ?? 0,
            failureMessages : test.failureMessages ?? [],
        }));
        // A failed file without a failed test: the failure must count
        if (file.status === "failed" && !tests.some(test => test.status === "failed")) {
            tests.push({
                name : ERRORS_OUTSIDE_TESTS,
                path : [ERRORS_OUTSIDE_TESTS],
                status : "failed",
                durationMs : 0,
                failureMessages : [file.message || "The file failed outside its tests, without a message."],
            });
        }
        return { file : relativePath(file.name, rootDir), tests };
    });

    const starts = report.testResults.map(f => f.startTime).filter((t) : t is number => t !== undefined);
    const ends = report.testResults.map(f => f.endTime).filter((t) : t is number => t !== undefined);
    const startedAtMs = report.startTime ?? (starts.length > 0 ? Math.min(...starts) : 0);
    const durationMs = ends.length > 0 ? Math.max(...ends) - startedAtMs : 0;

    return {
        ...meta,
        startedAt : new Date(startedAtMs).toISOString(),
        durationMs : Math.max(0, durationMs),
        files,
    };
}

/** The parts of an Istanbul `coverage-summary.json` (Vitest's `json-summary` reporter) that the converter reads. */
export type IstanbulSummary = Record<string, {
    lines : IstanbulCounts;
    statements : IstanbulCounts;
    functions : IstanbulCounts;
    branches : IstanbulCounts;
}>;

type IstanbulCounts = { total : number; covered : number };

function counts(c : IstanbulCounts) : CoverageCounts {
    return { covered : c.covered, total : c.total };
}

export function fromIstanbulSummary(summary : IstanbulSummary, packageName : string, rootDir : string) : CoverageReport {
    const files : FileCoverage[] = [];
    let total : Omit<FileCoverage, "file"> | undefined;
    for (const [key, entry] of Object.entries(summary)) {
        const metrics = {
            lines : counts(entry.lines),
            statements : counts(entry.statements),
            functions : counts(entry.functions),
            branches : counts(entry.branches),
        };
        if (key === "total") {
            total = metrics;
        } else {
            files.push({ file : relativePath(key, rootDir), ...metrics });
        }
    }
    const empty = { covered : 0, total : 0 };
    return {
        packageName,
        total : total ?? { lines : empty, statements : empty, functions : empty, branches : empty },
        files : files.sort((a, b) => a.file.localeCompare(b.file)),
    };
}

/** The parts of a Stryker `mutation.json` (mutation-testing-report-schema) that the converter reads. */
export type StrykerReport = {
    files : Record<string, { mutants : Array<{ status : string }> }>;
};

const VALID_FOR_SCORE : readonly MutantStatus[] = ["Killed", "Timeout", "Survived", "NoCoverage"];

function mutationScore(c : Partial<Record<MutantStatus, number>>) : number {
    const detected = (c.Killed ?? 0) + (c.Timeout ?? 0);
    const valid = VALID_FOR_SCORE.reduce((sum, status) => sum + (c[status] ?? 0), 0);
    return valid === 0 ? 100 : (detected / valid) * 100;
}

/** The commit and the time of a Stryker run. */
export type MutationOrigin = Pick<MutationReport, "commit" | "createdAt">;

export function fromStrykerReport(report : StrykerReport, packageName : string, rootDir : string, origin : MutationOrigin = {}) : MutationReport {
    const files : MutationFile[] = [];
    const totals : Partial<Record<MutantStatus, number>> = {};
    for (const [file, { mutants }] of Object.entries(report.files)) {
        const fileCounts : Partial<Record<MutantStatus, number>> = {};
        for (const { status } of mutants) {
            const key = status as MutantStatus;
            fileCounts[key] = (fileCounts[key] ?? 0) + 1;
            totals[key] = (totals[key] ?? 0) + 1;
        }
        files.push({ file : relativePath(file, rootDir), counts : fileCounts, score : mutationScore(fileCounts) });
    }
    return {
        packageName,
        score : mutationScore(totals),
        files : files.sort((a, b) => a.score - b.score),
        ...(origin.commit !== undefined ? { commit : origin.commit } : {}),
        ...(origin.createdAt !== undefined ? { createdAt : origin.createdAt } : {}),
    };
}

export function countStatuses(suites : readonly SuiteResult[]) : StatusCounts {
    const result : StatusCounts = { passed : 0, failed : 0, skipped : 0, todo : 0 };
    for (const suite of suites) {
        for (const file of suite.files) {
            for (const test of file.tests) result[test.status]++;
        }
    }
    return result;
}

export function countBudgets(budgets : readonly BudgetResult[]) : BudgetCounts {
    const pass = budgets.filter(budget => budget.pass).length;
    return { pass, fail : budgets.length - pass };
}

export function summarizeRun(run : RunReport, file : string) : RunSummary {
    return {
        id : run.id,
        createdAt : run.createdAt,
        ...(run.git ? { git : run.git } : {}),
        counts : countStatuses(run.suites),
        budgets : countBudgets(run.budgets),
        file,
    };
}
