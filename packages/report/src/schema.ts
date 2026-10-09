/**
 * The test-report data contract.
 *
 * The result collector (`@lag/scripts`) writes these shapes as JSON. The
 * website (`@lag/site`) reads them. Change `SCHEMA_VERSION` when a change
 * breaks old files.
 */

export const SCHEMA_VERSION = 1 as const;

export type TestStatus = "passed" | "failed" | "skipped" | "todo";

/** The type of a test suite. */
export type SuiteKind = "unit" | "browser" | "e2e" | "benchmark" | "soak" | "lint";

/** The runtime of a suite: "node", or a browser name, for example "chromium", "firefox", "webkit" or "chrome". */
export type Environment = string;

export type TestCaseResult = {
    /** The test title. */
    name : string;
    /** The titles of the parent `describe` blocks, then the test title. */
    path : string[];
    status : TestStatus;
    durationMs : number;
    failureMessages : string[];
};

export type TestFileResult = {
    /** The file path, relative to the repository root, with forward slashes. */
    file : string;
    tests : TestCaseResult[];
};

export type SuiteResult = {
    /** A unique ID in the run, for example "lag-unit-node". */
    id : string;
    /** The package name, for example "@lag/core". */
    packageName : string;
    kind : SuiteKind;
    environment : Environment;
    /** ISO 8601 time. */
    startedAt : string;
    durationMs : number;
    files : TestFileResult[];
};

export type CoverageCounts = {
    covered : number;
    total : number;
};

export type FileCoverage = {
    file : string;
    lines : CoverageCounts;
    statements : CoverageCounts;
    functions : CoverageCounts;
    branches : CoverageCounts;
};

export type CoverageReport = {
    packageName : string;
    total : Omit<FileCoverage, "file">;
    files : FileCoverage[];
};

export type MutantStatus = "Killed" | "Survived" | "NoCoverage" | "Timeout" | "CompileError" | "RuntimeError" | "Ignored";

export type MutationFile = {
    file : string;
    counts : Partial<Record<MutantStatus, number>>;
    /**
     * The number of `Killed` and `Timeout` mutants divided by the number of
     * valid mutants (`Killed`, `Timeout`, `Survived` and `NoCoverage`), from 0
     * to 100.
     */
    score : number;
};

export type MutationReport = {
    packageName : string;
    score : number;
    files : MutationFile[];
    /** The commit that Stryker tested, if it is known. */
    commit? : string;
    /**
     * The ISO 8601 time of the Stryker run. The mutation tests do not operate
     * in each run of the test program, thus this time is usually earlier than
     * the time of the run.
     */
    createdAt? : string;
};

/**
 * A set of values from one measurement, for example the DriftLag samples
 * from one stress profile.
 */
export type Measurement = {
    /** The ID of the suite that recorded the values. */
    suiteId : string;
    /** A unique name in the suite, for example "stress/heavy/lag_drift_histogram". */
    name : string;
    unit : string;
    values : number[];
    /** Low-cardinality labels, for example `{ profile: "heavy", browser: "chromium" }`. */
    labels : Record<string, string>;
};

/** A budget check, for example "DriftLag adds less than 2% CPU". */
export type BudgetResult = {
    name : string;
    unit : string;
    value : number;
    limit : number;
    /** True if `value` is in the limit. */
    pass : boolean;
};

export type GitInfo = {
    commit : string;
    branch : string;
};

/** All results from one run of the test program. */
export type RunReport = {
    schemaVersion : typeof SCHEMA_VERSION;
    id : string;
    /** ISO 8601 time. */
    createdAt : string;
    git? : GitInfo;
    suites : SuiteResult[];
    coverage : CoverageReport[];
    mutation : MutationReport[];
    measurements : Measurement[];
    budgets : BudgetResult[];
};

export type StatusCounts = Record<TestStatus, number>;

/** One entry in the list of runs. */
export type RunSummary = {
    id : string;
    createdAt : string;
    git? : GitInfo;
    counts : StatusCounts;
    /** The file name of the full `RunReport`, relative to the index file. */
    file : string;
};

export type RunIndex = {
    schemaVersion : typeof SCHEMA_VERSION;
    runs : RunSummary[];
};
