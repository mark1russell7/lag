import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestModule } from "vitest/node";
import { ERRORS_OUTSIDE_TESTS, countStatuses, fromVitestJson } from "@lag/report";
import { PROJECT_REPORT_DIR_ENV, toProjectReports } from "./project-reporter.js";
import type { ProjectReport } from "./model.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const vitest = path.join(here, "../../node_modules/vitest/vitest.mjs");
// Forward slashes: Vitest resolves the reporter path as a module specifier
const reporter = path.join(here, "project-reporter.ts").replace(/\\/g, "/");

const FIXTURES : Readonly<Record<string, string>> = {
    "before-all.test.ts" : `describe("outer", () => {
    beforeAll(() => { throw new Error("beforeAll broke"); });
    it("a", () => {});
    it("b", () => {});
});
`,
    "top-level.test.ts" : `throw new Error("import broke");\n`,
    "after-all.test.ts" : `describe("suite", () => {
    afterAll(() => { throw new Error("afterAll broke"); });
    it("c", () => {});
});
`,
    "passing.test.ts" : `it("d", () => {});\n`,
};

describe("project reporter with Vitest", () => {
    let temp : string;
    let report : ProjectReport;
    let exitCode : number | null;

    // Vitest in its own process, with the reporter, as the collector starts it
    beforeAll(() => {
        temp = mkdtempSync(path.join(os.tmpdir(), "lag-reporter-"));
        const out = path.join(temp, "reports");
        writeFileSync(path.join(temp, "package.json"), "{}\n");
        for (const [name, text] of Object.entries(FIXTURES)) {
            writeFileSync(path.join(temp, name), text);
        }
        const result = spawnSync(process.execPath, [vitest, "run", "--root", temp, "--globals", "--reporter=dot", `--reporter=${reporter}`], {
            cwd : temp,
            encoding : "utf8",
            env : { ...process.env, [PROJECT_REPORT_DIR_ENV] : out },
        });
        exitCode = result.status;
        const files = readdirSync(out);
        expect(files).toEqual(["default.json"]);
        report = JSON.parse(readFileSync(path.join(out, files[0]!), "utf8")) as ProjectReport;
    }, 120_000);

    afterAll(() => rmSync(temp, { recursive : true, force : true }));

    const fileOf = (name : string) => report.testResults.find(file => file.name.endsWith(name))?.assertionResults;

    it("adds a failed test for a beforeAll hook that failed, and keeps its tests skipped", () => {
        expect(fileOf("before-all.test.ts")).toEqual([
            { title : "a", ancestorTitles : ["outer"], status : "skipped", duration : null, failureMessages : [] },
            { title : "b", ancestorTitles : ["outer"], status : "skipped", duration : null, failureMessages : [] },
            { title : ERRORS_OUTSIDE_TESTS, ancestorTitles : ["outer"], status : "failed", duration : null, failureMessages : [expect.stringContaining("beforeAll broke")] },
        ]);
    });

    it("adds a failed test for a file that failed at its import", () => {
        expect(fileOf("top-level.test.ts")).toEqual([
            { title : ERRORS_OUTSIDE_TESTS, ancestorTitles : [], status : "failed", duration : null, failureMessages : [expect.stringContaining("import broke")] },
        ]);
    });

    it("adds a failed test for an afterAll hook that failed, and keeps its tests passed", () => {
        expect(fileOf("after-all.test.ts")).toEqual([
            { title : "c", ancestorTitles : ["suite"], status : "passed", duration : expect.any(Number), failureMessages : [] },
            { title : ERRORS_OUTSIDE_TESTS, ancestorTitles : ["suite"], status : "failed", duration : null, failureMessages : [expect.stringContaining("afterAll broke")] },
        ]);
    });

    it("adds nothing to a file that passed, and the counts agree with the exit code of Vitest", () => {
        expect(fileOf("passing.test.ts")?.map(test => [test.title, test.status])).toEqual([["d", "passed"]]);
        const suite = fromVitestJson(report, { id : "probe", packageName : "@lag/probe", kind : "unit", environment : "node" }, temp);
        expect(exitCode).toBe(1);
        expect(countStatuses([suite])).toEqual({ passed : 2, failed : 3, skipped : 2, todo : 0 });
    });
});

describe("project reporter", () => {
    it("adds a failed test for a file that Vitest marks as failed without an error", () => {
        const module = {
            project : { name : "", getProvidedContext : () => ({}), config : { browser : { enabled : false, name : "" } } },
            moduleId : "/repo/src/crash.test.ts",
            children : { allTests : function* () {}, allSuites : function* () {} },
            errors : () => [],
            state : () => "failed",
        } as unknown as TestModule;

        const [report] = toProjectReports([module]);

        expect(report!.testResults[0]!.assertionResults).toEqual([{
            title : ERRORS_OUTSIDE_TESTS,
            ancestorTitles : [],
            status : "failed",
            duration : null,
            failureMessages : ["Vitest marks the file as failed, but it gives no error and no failed test."],
        }]);
    });
});
