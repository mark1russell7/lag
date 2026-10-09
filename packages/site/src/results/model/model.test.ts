import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type RunReport } from "../../adapters/lag-report";
import { SAMPLE_RUNS } from "../../fixtures/sample-results";
import { budgetCounts, budgetRows } from "./budgets";
import { coverageFileRows, coveragePackageRows, percent } from "./coverage";
import { durationBins } from "./durations";
import { compareEnvironments, environmentMatrix } from "./matrix";
import {
    defaultGroupingKey,
    GROUP_BY_MEASUREMENT,
    groupingKeys,
    groupMeasurements,
    measurementFamilies,
    metricOf,
    OTHER_GROUP,
} from "./measurements";
import { mutationFileRows, mutationOrigins, mutationPackageRows } from "./mutation";
import { nextSort, sortRows } from "./sort";
import { countsText, failingTests, filterSuites, flattenTests, groupStatus, matchesFilter, parseStatusFilter, slowestTests } from "./tests";
import { runTrend, sortRunsNewestFirst } from "./trend";

const run = SAMPLE_RUNS[1]!.report;

function emptyRun(overrides : Partial<RunReport> = {}) : RunReport {
    return {
        schemaVersion : SCHEMA_VERSION,
        id : "r",
        createdAt : "2026-01-01T00:00:00.000Z",
        suites : [],
        coverage : [],
        mutation : [],
        measurements : [],
        budgets : [],
        ...overrides,
    };
}

describe("tests model", () => {
    it("flattens every test with its suite and file", () => {
        const rows = flattenTests(run);
        const total = run.suites.reduce((sum, suite) => sum + suite.files.reduce((count, file) => count + file.tests.length, 0), 0);
        expect(rows).toHaveLength(total);
        expect(new Set(rows.map(row => row.key)).size).toBe(rows.length);
        expect(rows[0]?.fullName).toContain(" › ");
    });

    it("finds the failed and the slowest tests", () => {
        expect(failingTests(run).map(row => row.environment).sort()).toEqual(["firefox", "node", "webkit"]);
        const slowest = slowestTests(run, 5);
        expect(slowest).toHaveLength(5);
        for (let index = 1; index < slowest.length; index++) {
            expect(slowest[index - 1]!.durationMs).toBeGreaterThanOrEqual(slowest[index]!.durationMs);
        }
    });

    it("filters by text, status and environment", () => {
        const [row] = failingTests(run).filter(candidate => candidate.environment === "webkit");
        expect(row).toBeDefined();
        expect(matchesFilter(row!, { query : "MAIN THREAD", status : "all" })).toBe(true);
        expect(matchesFilter(row!, { query : "", status : "passed" })).toBe(false);
        expect(matchesFilter(row!, { query : "", status : "all", environment : "firefox" })).toBe(false);
        expect(parseStatusFilter("failed")).toBe("failed");
        expect(parseStatusFilter("broken")).toBe("all");
        expect(parseStatusFilter(null)).toBe("all");
    });

    it("groups the matching tests by suite and file", () => {
        const groups = filterSuites(run, { query : "", status : "failed" });
        expect(groups.map(group => group.suite.id).sort()).toEqual(["core-unit-node", "integration-browser-firefox", "integration-browser-webkit"]);
        expect(groups.every(group => group.counts.failed === group.files.reduce((sum, file) => sum + file.tests.length, 0))).toBe(true);
        expect(filterSuites(run, { query : "", status : "all" }, "load-unit-node")).toHaveLength(1);
    });
});

describe("group status", () => {
    const counts = (passed : number, failed : number, skipped : number, todo : number) => ({ passed, failed, skipped, todo });

    it("shows a group with only skipped tests as skipped, and a group without tests as none, not as passed", () => {
        expect(groupStatus(counts(0, 0, 3, 0))).toBe("skipped");
        expect(groupStatus(counts(0, 0, 0, 0))).toBe("none");
        expect(groupStatus(counts(0, 0, 0, 2))).toBe("todo");
        expect(groupStatus(counts(5, 0, 3, 1))).toBe("passed");
        expect(groupStatus(counts(5, 1, 0, 0))).toBe("failed");
    });

    it("gives the counts as text", () => {
        expect(countsText(counts(0, 0, 3, 0))).toBe("3 skipped");
        expect(countsText(counts(0, 0, 0, 0))).toBe("No tests");
        expect(countsText(counts(5, 0, 3, 1))).toBe("5 passed, 3 skipped, 1 to do");
        expect(countsText(counts(5, 2, 0, 0))).toBe("2 failed of 7");
    });
});

describe("environment matrix", () => {
    it("puts node first, then the engines", () => {
        expect(["webkit", "custom", "node", "firefox", "chromium"].sort(compareEnvironments)).toEqual(["node", "chromium", "firefox", "webkit", "custom"]);
    });

    it("has one cell for each package and environment", () => {
        const matrix = environmentMatrix(run);
        expect(matrix.environments).toEqual(["node", "chromium", "firefox", "webkit"]);
        const core = matrix.rows.find(row => row.packageName === "@lag/core")!;
        expect(core.cells[0]?.counts.failed).toBe(1);
        expect(core.cells[1]).toBeUndefined();
    });
});

describe("durationBins", () => {
    it("counts in 1-2-5 bins and trims the empty ends", () => {
        const bins = durationBins([0.5, 1.5, 3, 4, 700, 1500, -1, Number.NaN]);
        expect(bins[0]).toMatchObject({ label : "0–1 ms", count : 1 });
        expect(bins.at(-1)).toMatchObject({ label : "1–2 s", count : 1 });
        expect(bins.find(bin => bin.label === "2–5 ms")?.count).toBe(2);
        expect(bins.find(bin => bin.label === "500–1000 ms")?.count).toBe(1);
        expect(durationBins([])).toEqual([]);
        expect(durationBins([90_000])[0]?.label).toBe("50 s or more");
    });
});

describe("coverage model", () => {
    it("calculates percentages, and undefined for nothing to cover", () => {
        expect(percent({ covered : 1, total : 4 })).toBe(25);
        expect(percent({ covered : 0, total : 0 })).toBeUndefined();
    });

    it("gives rows for packages and files", () => {
        const packages = coveragePackageRows(run);
        expect(packages.map(row => row.packageName)).toEqual(["@lag/core", "@lag/load", "@lag/report"]);
        expect(packages[0]?.lines).toBeGreaterThan(50);
        expect(coverageFileRows(run).length).toBe(run.coverage.reduce((sum, report) => sum + report.files.length, 0));
    });
});

describe("mutation model", () => {
    it("sorts the files by score and sums the packages", () => {
        const files = mutationFileRows(run);
        for (let index = 1; index < files.length; index++) {
            expect(files[index - 1]!.score).toBeLessThanOrEqual(files[index]!.score);
        }
        const [core] = mutationPackageRows(run);
        expect(core?.files).toBe(files.length);
        expect(core?.total).toBe(files.reduce((sum, file) => sum + file.total, 0));
    });

    it("gives the commit and the time of each Stryker run, and its age in days", () => {
        const report = { packageName : "@lag/core", score : 96, files : [] };
        const origins = mutationOrigins(emptyRun({
            createdAt : "2026-10-08T12:00:00.000Z",
            mutation : [
                { ...report, commit : "abc1234def567", createdAt : "2026-10-04T03:41:00.000Z" },
                { ...report, packageName : "@lag/other" },
            ],
        }));
        expect(origins).toEqual([
            { packageName : "@lag/core", commit : "abc1234def567", createdAt : "2026-10-04T03:41:00.000Z", daysBeforeRun : 4 },
            { packageName : "@lag/other", commit : undefined, createdAt : undefined, daysBeforeRun : undefined },
        ]);
    });
});

describe("budgets model", () => {
    it("puts the failed budgets first", () => {
        const rows = budgetRows(run);
        expect(rows[0]?.pass).toBe(false);
        expect(rows[0]?.margin).toBeLessThan(0);
        expect(budgetCounts(run)).toEqual({ pass : 3, fail : 1 });
        expect(budgetCounts(emptyRun())).toEqual({ pass : 0, fail : 0 });
    });
});

describe("measurements model", () => {
    it("groups measurements by metric", () => {
        expect(metricOf("stress/heavy/lag_drift_histogram")).toBe("lag_drift_histogram");
        const families = measurementFamilies(run);
        expect(families.map(family => family.metric)).toEqual(["lag_drift_histogram", "lag_frame_delta_histogram", "lag_worker_main_block_histogram"]);
    });

    it("offers the measurement, the suite and each label as grouping keys", () => {
        expect(groupingKeys(run.measurements)).toEqual([GROUP_BY_MEASUREMENT, "suite", "browser", "profile"]);
        expect(defaultGroupingKey(run.measurements)).toBe("profile");
        expect(defaultGroupingKey([])).toBe(GROUP_BY_MEASUREMENT);
    });

    it("joins the values of each group and summarizes them", () => {
        const drift = measurementFamilies(run).find(family => family.metric === "lag_drift_histogram")!;
        const byBrowser = groupMeasurements(drift.measurements, "browser");
        expect(byBrowser.map(group => group.group)).toEqual(["chromium", "firefox", "webkit"]);
        expect(byBrowser[0]?.values.length).toBe(3 * 240);
        expect(byBrowser[0]?.summary.p95).toBeGreaterThanOrEqual(byBrowser[0]?.summary.p50 ?? 0);
    });

    it("folds the smallest groups into Other past the limit", () => {
        const measurements = Array.from({ length : 10 }, (_, index) => ({
            suiteId : "s",
            name : `m${index}`,
            unit : "ms",
            values : Array.from({ length : index + 1 }, () => index),
            labels : {},
        }));
        const groups = groupMeasurements(measurements, GROUP_BY_MEASUREMENT, 4);
        expect(groups).toHaveLength(4);
        expect(groups.at(-1)?.group).toBe(OTHER_GROUP);
        expect(groups.reduce((sum, group) => sum + group.values.length, 0)).toBe(55);
    });
});

describe("sortRows", () => {
    const rows = [{ name : "b", value : 2 }, { name : "a", value : undefined }, { name : "c", value : 1 }];

    it("sorts numbers and keeps missing values last in both directions", () => {
        const valueOf = (row : (typeof rows)[number], key : "name" | "value") : string | number | undefined => row[key];
        expect(sortRows(rows, { key : "value", direction : "ascending" }, valueOf).map(row => row.name)).toEqual(["c", "b", "a"]);
        expect(sortRows(rows, { key : "value", direction : "descending" }, valueOf).map(row => row.name)).toEqual(["b", "c", "a"]);
        expect(sortRows(rows, { key : "name", direction : "descending" }, valueOf).map(row => row.name)).toEqual(["c", "b", "a"]);
    });

    it("changes the direction for the same column", () => {
        expect(nextSort({ key : "a", direction : "ascending" }, "a")).toEqual({ key : "a", direction : "descending" });
        expect(nextSort<"a" | "b">({ key : "a", direction : "descending" }, "b", "descending")).toEqual({ key : "b", direction : "descending" });
    });
});

describe("run trend", () => {
    it("orders the runs and makes one row per status", async () => {
        const index = { schemaVersion : SCHEMA_VERSION, runs : SAMPLE_RUNS.map(({ report, file }) => ({ id : report.id, createdAt : report.createdAt, file, counts : { passed : 1, failed : 2, skipped : 3, todo : 4 } })) };
        expect(sortRunsNewestFirst(index.runs).map(item => item.id)).toEqual([SAMPLE_RUNS[1]!.report.id, SAMPLE_RUNS[0]!.report.id]);
        const trend = runTrend(index);
        expect(trend).toHaveLength(8);
        expect(trend[0]).toMatchObject({ runId : SAMPLE_RUNS[0]!.report.id, status : "failed", count : 2 });
    });
});
