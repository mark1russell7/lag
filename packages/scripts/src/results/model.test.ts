import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type RunReport } from "@lag/report";
import { reportFileName } from "./project-reporter.js";
import {
    changedDuringRun,
    mergeIndex,
    mutationOrigin,
    packageSlug,
    parseResultLines,
    runExitCode,
    runFile,
    runId,
    suiteKind,
    suiteMeta,
    toBudgets,
    toMeasurements,
    type ResultRecord,
} from "./model.js";

function run(id : string, createdAt : string) : RunReport {
    return { schemaVersion : SCHEMA_VERSION, id, createdAt, suites : [], coverage : [], mutation : [], measurements : [], budgets : [] };
}

const measurement = (project : string, name : string, values : number[]) : ResultRecord => ({
    kind : "measurement",
    project,
    environment : project.match(/\((.*)\)/)?.[1] ?? "node",
    file : "src/stress.test.ts",
    measurement : { name, unit : "ms", values, labels : { browser : "chromium" } },
});

describe("suite names", () => {
    it("names a suite after the package, the project and the environment", () => {
        expect(suiteMeta("@lag/integration-tests", "browser (firefox)", "firefox")).toEqual({
            id : "integration-browser-firefox", packageName : "@lag/integration-tests", kind : "browser", environment : "firefox",
        });
        expect(suiteMeta("@lag/integration-tests", "coi (webkit)", "webkit").id).toBe("integration-coi-webkit");
        expect(suiteMeta("@mark1russell7/lag", "", "node")).toMatchObject({ id : "core-unit-node", kind : "unit" });
        expect(suiteMeta("@lag/site", "node", "node")).toMatchObject({ id : "site-unit-node", kind : "unit" });
        expect(suiteMeta("@lag/site", "browser (chromium)", "chromium")).toMatchObject({ id : "site-browser-chromium", kind : "browser" });
    });

    it("finds the kind of a suite from the project", () => {
        expect(suiteKind("overhead (chromium)", "chromium")).toBe("benchmark");
        expect(suiteKind("soak (chromium)", "chromium")).toBe("soak");
        expect(suiteKind("e2e (chromium)", "chromium")).toBe("e2e");
        expect(suiteKind("cdp (chromium)", "chromium")).toBe("browser");
        expect(suiteKind("", "node")).toBe("unit");
    });

    it("shortens the package names", () => {
        expect(packageSlug("@mark1russell7/lag")).toBe("core");
        expect(packageSlug("@lag/integration-tests")).toBe("integration");
    });

    it("gives each project report a file name without spaces", () => {
        expect(reportFileName("browser (chromium)")).toBe("browser-chromium.json");
        expect(reportFileName("")).toBe("default.json");
    });
});

describe("results.jsonl", () => {
    it("reads the valid records and leaves out the other lines", () => {
        const lines = [
            JSON.stringify(measurement("browser (chromium)", "stress/heavy/lag_drift_histogram", [1, 2])),
            "",
            "{not json",
            JSON.stringify({ kind : "other" }),
            JSON.stringify({ kind : "budget", project : "overhead (chromium)", environment : "chromium", file : "", budget : { name : "CPU", unit : "%", value : 1, limit : 2, pass : true } }),
        ].join("\r\n");
        expect(parseResultLines(lines).map(r => r.kind)).toEqual(["measurement", "budget"]);
    });

    it("gives each measurement the suite of its project and joins the same name", () => {
        const measurements = toMeasurements([
            measurement("browser (chromium)", "stress/heavy/lag_drift_histogram", [1, 2]),
            measurement("browser (chromium)", "stress/heavy/lag_drift_histogram", [3]),
            measurement("browser (firefox)", "stress/heavy/lag_drift_histogram", [4]),
        ], "@lag/integration-tests");
        expect(measurements).toEqual([
            { suiteId : "integration-browser-chromium", name : "stress/heavy/lag_drift_histogram", unit : "ms", values : [1, 2, 3], labels : { browser : "chromium" } },
            { suiteId : "integration-browser-firefox", name : "stress/heavy/lag_drift_histogram", unit : "ms", values : [4], labels : { browser : "chromium" } },
        ]);
    });

    it("keeps one budget for each name, calculates `pass` again and puts the failed ones first", () => {
        const budget = (name : string, value : number, limit : number) : ResultRecord =>
            ({ kind : "budget", project : "overhead (chromium)", environment : "chromium", file : "", budget : { name, unit : "%", value, limit, pass : true } });
        expect(toBudgets([budget("b", 1, 2), budget("a", 3, 2), budget("b", 1.5, 2)])).toEqual([
            { name : "a", unit : "%", value : 3, limit : 2, pass : false },
            { name : "b", unit : "%", value : 1.5, limit : 2, pass : true },
        ]);
    });
});

describe("the run index", () => {
    it("makes a run ID that sorts by time and has the short commit", () => {
        expect(runId(new Date("2026-10-07T15:30:12.345Z"), "b492a0a6f00d")).toBe("2026-10-07-153012-b492a0a");
        expect(runId(new Date("2026-10-07T15:30:12.345Z"))).toBe("2026-10-07-153012");
        expect(runFile("x")).toBe("runs/x.json");
    });

    it("adds the run to the index, oldest first, and replaces a run with the same ID", () => {
        const first = mergeIndex(undefined, run("b", "2026-10-07T10:00:00.000Z"));
        const second = mergeIndex(first, run("a", "2026-10-06T10:00:00.000Z"));
        const again = mergeIndex(second, run("b", "2026-10-07T10:00:00.000Z"));
        expect(again.schemaVersion).toBe(SCHEMA_VERSION);
        expect(again.runs.map(r => [r.id, r.file])).toEqual([["a", "runs/a.json"], ["b", "runs/b.json"]]);
    });

    it("gives the summary of the new run its budget counts, and keeps an older summary without them", () => {
        const old = { schemaVersion : SCHEMA_VERSION, runs : [{ id : "a", createdAt : "2026-10-06T10:00:00.000Z", counts : { passed : 1, failed : 0, skipped : 0, todo : 0 }, file : "runs/a.json" }] };
        const next = { ...run("b", "2026-10-07T10:00:00.000Z"), budgets : [{ name : "CPU", unit : "%", value : 3, limit : 2, pass : false }] };
        const index = mergeIndex(old, next);
        expect(index.runs.map(r => [r.id, r.budgets])).toEqual([["a", undefined], ["b", { pass : 0, fail : 1 }]]);
    });

    it("starts again from an index that the site cannot read, and keeps at most maxRuns", () => {
        expect(mergeIndex({ schemaVersion : 0, runs : [{ id : "old" }] }, run("n", "2026-10-07T10:00:00.000Z")).runs.map(r => r.id)).toEqual(["n"]);
        let index = mergeIndex(undefined, run("r0", "2026-10-01T00:00:00.000Z"));
        for (let i = 1; i < 5; i++) index = mergeIndex(index, run(`r${i}`, `2026-10-0${i + 1}T00:00:00.000Z`), 3);
        expect(index.runs.map(r => r.id)).toEqual(["r2", "r3", "r4"]);
    });
});

describe("the result of the collector", () => {
    const passing = { name : "CPU", unit : "%", value : 1, limit : 2, pass : true };

    it("fails when a step gave an exit code that is not 0, also without a failed test", () => {
        expect(runExitCode(0, [passing], [0, 0])).toBe(0);
        expect(runExitCode(0, [passing], [0, 1])).toBe(1);
        expect(runExitCode(0, [], [2])).toBe(1);
    });

    it("fails when a test or a budget failed", () => {
        expect(runExitCode(1, [], [0])).toBe(1);
        expect(runExitCode(0, [{ ...passing, value : 3, pass : false }], [0])).toBe(1);
    });

    it("uses only the files that changed during the run, with a tolerance of 2 s", () => {
        const start = new Date("2026-10-08T12:00:00.000Z");
        expect(changedDuringRun(new Date("2026-10-08T12:05:00.000Z"), start)).toBe(true);
        expect(changedDuringRun(new Date("2026-10-08T11:59:58.000Z"), start)).toBe(true);
        expect(changedDuringRun(new Date("2026-10-08T11:59:57.999Z"), start)).toBe(false);
        expect(changedDuringRun(new Date("2026-10-01T09:00:00.000Z"), start)).toBe(false);
    });
});

describe("the origin of the mutation report", () => {
    const modified = new Date("2026-10-08T09:00:00.000Z");

    it("takes the commit and the time from the file of the Pages workflow", () => {
        expect(mutationOrigin({ commit : "abc1234def", createdAt : "2026-10-04T03:41:07Z" }, modified)).toEqual({
            commit : "abc1234def",
            createdAt : "2026-10-04T03:41:07.000Z",
        });
    });

    it("uses the time of the report file, and no commit, without a valid file", () => {
        expect(mutationOrigin(undefined, modified)).toEqual({ createdAt : "2026-10-08T09:00:00.000Z" });
        expect(mutationOrigin({ commit : "", createdAt : "not a date" }, modified)).toEqual({ createdAt : "2026-10-08T09:00:00.000Z" });
        expect(mutationOrigin({ commit : 42 }, modified)).toEqual({ createdAt : "2026-10-08T09:00:00.000Z" });
    });
});
