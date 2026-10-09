import {
    countStatuses,
    type RunReport,
    type StatusCounts,
    type SuiteKind,
    type SuiteResult,
    type TestStatus,
} from "../../adapters/lag-report";

/** One test, with the suite and the file that it is in. */
export type TestRow = {
    /** Unique in the run. */
    key : string;
    suiteId : string;
    packageName : string;
    kind : SuiteKind;
    environment : string;
    file : string;
    name : string;
    path : readonly string[];
    /** The describe blocks and the test title, joined with " › ". */
    fullName : string;
    status : TestStatus;
    durationMs : number;
    failureMessages : readonly string[];
};

export const STATUS_ORDER : readonly TestStatus[] = ["failed", "passed", "skipped", "todo"];

export function suiteRows(suite : SuiteResult) : TestRow[] {
    return suite.files.flatMap(file => file.tests.map((test, index) : TestRow => ({
        key : `${suite.id}::${file.file}::${index}::${test.path.join("/")}`,
        suiteId : suite.id,
        packageName : suite.packageName,
        kind : suite.kind,
        environment : suite.environment,
        file : file.file,
        name : test.name,
        path : test.path,
        fullName : test.path.join(" › "),
        status : test.status,
        durationMs : test.durationMs,
        failureMessages : test.failureMessages,
    })));
}

export function flattenTests(run : RunReport) : TestRow[] {
    return run.suites.flatMap(suiteRows);
}

export function failingTests(run : RunReport) : TestRow[] {
    return flattenTests(run).filter(row => row.status === "failed");
}

/** The slowest tests that passed or failed, slowest first. */
export function slowestTests(run : RunReport, limit = 10) : TestRow[] {
    return flattenTests(run)
        .filter(row => row.status === "passed" || row.status === "failed")
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, limit);
}

/** The durations of the tests that passed or failed, in ms. */
export function testDurations(run : RunReport) : number[] {
    return flattenTests(run)
        .filter(row => row.status === "passed" || row.status === "failed")
        .map(row => row.durationMs);
}

export type StatusFilter = TestStatus | "all";

export type TestFilter = {
    /** The query matches the test name, the describe blocks, the file and the package, without case. */
    query : string;
    status : StatusFilter;
    /** Only the tests in this environment, for example "firefox". */
    environment? : string | undefined;
};

export function parseStatusFilter(value : string | null | undefined) : StatusFilter {
    return STATUS_ORDER.includes(value as TestStatus) ? value as TestStatus : "all";
}

export function matchesFilter(row : TestRow, filter : TestFilter) : boolean {
    if (filter.status !== "all" && row.status !== filter.status) return false;
    if (filter.environment && row.environment !== filter.environment) return false;
    const query = filter.query.trim().toLowerCase();
    if (query === "") return true;
    return [row.fullName, row.file, row.packageName, row.environment]
        .some(text => text.toLowerCase().includes(query));
}

export type FileGroup = {
    file : string;
    tests : TestRow[];
    counts : StatusCounts;
};

export type SuiteGroup = {
    suite : SuiteResult;
    files : FileGroup[];
    counts : StatusCounts;
    /** The number of tests in the suite before the filter. */
    totalTests : number;
};

function countRows(rows : readonly TestRow[]) : StatusCounts {
    const counts : StatusCounts = { passed : 0, failed : 0, skipped : 0, todo : 0 };
    for (const row of rows) counts[row.status]++;
    return counts;
}

/** The suites and files that have tests that match the filter. */
export function filterSuites(run : RunReport, filter : TestFilter, suiteId? : string) : SuiteGroup[] {
    const groups : SuiteGroup[] = [];
    for (const suite of run.suites) {
        if (suiteId !== undefined && suite.id !== suiteId) continue;
        const rows = suiteRows(suite);
        const byFile = new Map<string, TestRow[]>();
        for (const row of rows) {
            if (!matchesFilter(row, filter)) continue;
            const list = byFile.get(row.file) ?? [];
            list.push(row);
            byFile.set(row.file, list);
        }
        if (byFile.size === 0) continue;
        const files = [...byFile].map(([file, tests]) => ({ file, tests, counts : countRows(tests) }));
        groups.push({
            suite,
            files,
            counts : countRows(files.flatMap(file => file.tests)),
            totalTests : rows.length,
        });
    }
    return groups;
}

export function runCounts(run : RunReport) : StatusCounts {
    return countStatuses(run.suites);
}

export function totalTests(counts : StatusCounts) : number {
    return counts.passed + counts.failed + counts.skipped + counts.todo;
}

/** The status of a group of tests. "none" is a group without tests. */
export type GroupStatus = TestStatus | "none";

/**
 * The status of a group of tests, for its icon: failed if a test failed,
 * passed if a test passed. A group with only skipped tests is skipped, not
 * passed.
 */
export function groupStatus(counts : StatusCounts) : GroupStatus {
    if (counts.failed > 0) return "failed";
    if (counts.passed > 0) return "passed";
    if (counts.skipped > 0) return "skipped";
    if (counts.todo > 0) return "todo";
    return "none";
}

/** The counts of a group as text, for example "2 failed of 10, 1 skipped" or "No tests". */
export function countsText(counts : StatusCounts) : string {
    const total = totalTests(counts);
    if (total === 0) return "No tests";
    const parts : string[] = [];
    if (counts.failed > 0) parts.push(`${counts.failed} failed of ${total}`);
    else if (counts.passed > 0) parts.push(`${counts.passed} passed`);
    if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`);
    if (counts.todo > 0) parts.push(`${counts.todo} to do`);
    return parts.join(", ");
}

/** The sum of the suite durations, in ms. Suites can operate at the same time, so this is the total work, not the wall time. */
export function totalSuiteDuration(run : RunReport) : number {
    return run.suites.reduce((sum, suite) => sum + suite.durationMs, 0);
}
