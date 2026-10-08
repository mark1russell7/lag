import { describe, expect, it } from "vitest";
import {
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
            budgets : [],
        };

        expect(countStatuses(run.suites)).toEqual({ passed : 2, failed : 1, skipped : 0, todo : 0 });
        expect(summarizeRun(run, "runs/r1.json")).toEqual({
            id : "r1",
            createdAt : "2026-10-07T00:00:00.000Z",
            counts : { passed : 2, failed : 1, skipped : 0, todo : 0 },
            file : "runs/r1.json",
        });
    });
});
