import { describe, expect, it } from "vitest";
import {
    ERRORS_OUTSIDE_TESTS,
    countBudgets,
    countStatuses,
    fromIstanbulSummary,
    fromStrykerReport,
    fromVitestJson,
    relativePath,
    summarizeRun,
} from "./convert.js";
import { SCHEMA_VERSION, type RunReport } from "./schema.js";

describe("relativePath", () => {
    it("makes Windows and POSIX paths relative to the root, with forward slashes", () => {
        expect(relativePath("C:\\repo\\packages\\lag\\src\\a.ts", "C:\\repo")).toBe("packages/lag/src/a.ts");
        expect(relativePath("/repo/packages/a.ts", "/repo/")).toBe("packages/a.ts");
    });

    it("ignores case on the root, as Windows paths do", () => {
        expect(relativePath("c:/Repo/x.ts", "C:/repo")).toBe("x.ts");
    });

    it("keeps paths outside the root", () => {
        expect(relativePath("/other/x.ts", "/repo")).toBe("/other/x.ts");
    });
});

describe("fromVitestJson", () => {
    it("converts files, tests, statuses and timing", () => {
        const suite = fromVitestJson({
            startTime : 1_000,
            testResults : [{
                name : "/repo/packages/lag/src/DriftLag.test.ts",
                startTime : 1_000,
                endTime : 1_250,
                assertionResults : [
                    { title : "reports lag", ancestorTitles : ["DriftLag"], status : "passed", duration : 12 },
                    { title : "is skipped", ancestorTitles : [], status : "pending", duration : null },
                    { title : "fails", status : "failed", failureMessages : ["boom"] },
                    { title : "is unknown", status : "weird" },
                ],
            }],
        }, { id : "lag-unit-node", packageName : "@lag/core", kind : "unit", environment : "node" }, "/repo");

        expect(suite.startedAt).toBe(new Date(1_000).toISOString());
        expect(suite.durationMs).toBe(250);
        expect(suite.files[0]!.file).toBe("packages/lag/src/DriftLag.test.ts");
        expect(suite.files[0]!.tests.map(t => t.status)).toEqual(["passed", "skipped", "failed", "failed"]);
        expect(suite.files[0]!.tests[0]!.path).toEqual(["DriftLag", "reports lag"]);
        expect(suite.files[0]!.tests[1]!.durationMs).toBe(0);
        expect(suite.files[0]!.tests[2]!.failureMessages).toEqual(["boom"]);
    });

    it("adds a failed test for a file that failed without a failed test, as Vitest's JSON reporter writes it", () => {
        const meta = { id : "lag-unit-node", packageName : "@lag/core", kind : "unit", environment : "node" } as const;
        const suite = fromVitestJson({
            testResults : [
                // An error at the import: no tests
                { name : "/repo/a.test.ts", status : "failed", message : "import broke", assertionResults : [] },
                // A failed beforeAll hook of a suite: the tests are skipped, and the file has no message
                { name : "/repo/b.test.ts", status : "failed", message : "", assertionResults : [{ title : "x", status : "skipped" }] },
                // A failed test: the file needs no other failed test
                { name : "/repo/c.test.ts", status : "failed", message : "", assertionResults : [{ title : "y", status : "failed" }] },
                { name : "/repo/d.test.ts", status : "passed", message : "", assertionResults : [{ title : "z", status : "passed" }] },
            ],
        }, meta, "/repo");

        expect(suite.files.map(file => file.tests.map(test => [test.name, test.status, test.failureMessages]))).toEqual([
            [[ERRORS_OUTSIDE_TESTS, "failed", ["import broke"]]],
            [["x", "skipped", []], [ERRORS_OUTSIDE_TESTS, "failed", ["The file failed outside its tests, without a message."]]],
            [["y", "failed", []]],
            [["z", "passed", []]],
        ]);
        expect(countStatuses([suite])).toEqual({ passed : 1, failed : 3, skipped : 1, todo : 0 });
    });
});

describe("fromIstanbulSummary", () => {
    it("separates the total from the files and sorts the files", () => {
        const c = (covered : number, total : number) => ({ covered, total, skipped : 0, pct : 0 });
        const report = fromIstanbulSummary({
            total : { lines : c(8, 10), statements : c(8, 10), functions : c(2, 2), branches : c(1, 2) },
            "/repo/b.ts" : { lines : c(4, 5), statements : c(4, 5), functions : c(1, 1), branches : c(0, 1) },
            "/repo/a.ts" : { lines : c(4, 5), statements : c(4, 5), functions : c(1, 1), branches : c(1, 1) },
        }, "@lag/core", "/repo");

        expect(report.total.lines).toEqual({ covered : 8, total : 10 });
        expect(report.files.map(f => f.file)).toEqual(["a.ts", "b.ts"]);
    });
});

describe("fromStrykerReport", () => {
    it("counts mutants and calculates the score from valid mutants only", () => {
        const report = fromStrykerReport({
            files : {
                "/repo/a.ts" : { mutants : [{ status : "Killed" }, { status : "Survived" }, { status : "CompileError" }] },
                "/repo/b.ts" : { mutants : [{ status : "Killed" }, { status : "Timeout" }] },
            },
        }, "@lag/core", "/repo");

        // 3 detected (2 killed + 1 timeout) of 4 valid mutants
        expect(report.score).toBe(75);
        expect(report.files.map(f => [f.file, f.score])).toEqual([["a.ts", 50], ["b.ts", 100]]);
        expect(report.files[0]!.counts).toEqual({ Killed : 1, Survived : 1, CompileError : 1 });
        expect(report).not.toHaveProperty("commit");
        expect(report).not.toHaveProperty("createdAt");
    });

    it("keeps the commit and the time of the Stryker run", () => {
        const report = fromStrykerReport({ files : {} }, "@lag/core", "/repo", { commit : "abc1234def", createdAt : "2026-10-04T03:41:00.000Z" });
        expect(report).toEqual({ packageName : "@lag/core", score : 100, files : [], commit : "abc1234def", createdAt : "2026-10-04T03:41:00.000Z" });
    });
});

describe("run summaries", () => {
    it("counts statuses across suites", () => {
        const run : RunReport = {
            schemaVersion : SCHEMA_VERSION,
            id : "r1",
            createdAt : "2026-10-07T00:00:00.000Z",
            suites : [{
                id : "s",
                packageName : "@lag/core",
                kind : "unit",
                environment : "node",
                startedAt : "2026-10-07T00:00:00.000Z",
                durationMs : 1,
                files : [{
                    file : "a.ts",
                    tests : [
                        { name : "a", path : ["a"], status : "passed", durationMs : 1, failureMessages : [] },
                        { name : "b", path : ["b"], status : "failed", durationMs : 1, failureMessages : [] },
                        { name : "c", path : ["c"], status : "passed", durationMs : 1, failureMessages : [] },
                    ],
                }],
            }],
            coverage : [],
            mutation : [],
            measurements : [],
            budgets : [
                { name : "CPU", unit : "%", value : 3, limit : 2, pass : false },
                { name : "Memory", unit : "By", value : 1, limit : 2, pass : true },
                { name : "Worker p99", unit : "ms", value : 1, limit : 2, pass : true },
            ],
        };

        expect(countStatuses(run.suites)).toEqual({ passed : 2, failed : 1, skipped : 0, todo : 0 });
        expect(summarizeRun(run, "runs/r1.json")).toEqual({
            id : "r1",
            createdAt : "2026-10-07T00:00:00.000Z",
            counts : { passed : 2, failed : 1, skipped : 0, todo : 0 },
            budgets : { pass : 2, fail : 1 },
            file : "runs/r1.json",
        });
        expect(countBudgets([])).toEqual({ pass : 0, fail : 0 });
    });
});
