/**
 * This Vitest reporter writes one JSON file for each project (each browser
 * instance is a project), in the shape of Vitest's JSON reporter that
 * `fromVitestJson` reads. Vitest's own JSON reporter puts the files of all
 * projects in one list. Thus, if Vitest starts the tests of a file in four
 * browsers, the list has the file four times, with no project name.
 *
 * The collector gives it to Vitest by path:
 *   vitest run --reporter=default --reporter=<this file>
 * with LAG_PROJECT_REPORT_DIR set to the output folder.
 *
 * Some failures have no failed test. A `beforeAll` hook that fails skips the
 * tests of its suite, and an `afterAll` hook that fails keeps them passed. An
 * error at the import of a file gives a file without tests. For each file or
 * suite with such errors, the reporter adds a failed test with the title
 * `ERRORS_OUTSIDE_TESTS`. Thus the report counts the failure.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ERRORS_OUTSIDE_TESTS } from "@lag/report";
import type { Reporter, SerializedError, TestCase, TestModule, TestSuite } from "vitest/node";
import type { ProjectReport, ProjectReportFile } from "./model.js";

export const PROJECT_REPORT_DIR_ENV = "LAG_PROJECT_REPORT_DIR";

type AssertionResult = ProjectReportFile["assertionResults"][number];

function ancestors(entity : TestCase | TestSuite) : string[] {
    const titles : string[] = [];
    let parent = entity.parent;
    while (parent.type === "suite") {
        titles.unshift(parent.name);
        parent = parent.parent;
    }
    return titles;
}

function status(test : TestCase) : string {
    if (test.options.mode === "todo") return "todo";
    const state = test.result().state;
    return state === "pending" ? "skipped" : state;
}

function errorText(error : SerializedError) : string {
    return error.stack ?? error.message;
}

function messages(test : TestCase) : string[] {
    const result = test.result();
    const errors = result.errors?.map(errorText) ?? [];
    // The reason of ctx.skip(condition, reason): the site shows it with the test
    if (result.state === "skipped" && result.note) return [`Skipped: ${result.note}`, ...errors];
    return errors;
}

/**
 * The failed tests for the errors of the file and its suites outside the
 * tests: failed hooks, and errors at the import of the file. A file that
 * Vitest marks as failed, without an error and without a failed test, also
 * gets a failed test.
 */
function errorsOutsideTests(module : TestModule, tests : readonly AssertionResult[]) : AssertionResult[] {
    const failed = (path : string[], failureMessages : string[]) : AssertionResult => ({
        title : ERRORS_OUTSIDE_TESTS,
        ancestorTitles : path,
        status : "failed",
        duration : null,
        failureMessages,
    });
    const results : AssertionResult[] = [];
    if (module.errors().length > 0) results.push(failed([], module.errors().map(errorText)));
    for (const suite of module.children.allSuites()) {
        if (suite.errors().length > 0) results.push(failed([...ancestors(suite), suite.name], suite.errors().map(errorText)));
    }
    if (results.length === 0 && module.state() === "failed" && !tests.some(test => test.status === "failed")) {
        results.push(failed([], ["Vitest marks the file as failed, but it gives no error and no failed test."]));
    }
    return results;
}

function environmentOf(module : TestModule) : string {
    const provided = module.project.getProvidedContext() as { environment? : unknown };
    if (typeof provided.environment === "string") return provided.environment;
    const browser = module.project.config.browser;
    return browser.enabled ? browser.name : "node";
}

export function toProjectReports(modules : ReadonlyArray<TestModule>) : ProjectReport[] {
    const reports = new Map<string, ProjectReport>();
    for (const module of modules) {
        const name = module.project.name;
        const report = reports.get(name) ?? { project : name, environment : environmentOf(module), testResults : [] };
        const tests = [...module.children.allTests()];
        const timed = tests.map(test => test.diagnostic()).filter(d => d !== undefined);
        const startTime = timed.length > 0 ? Math.min(...timed.map(d => d.startTime)) : undefined;
        const endTime = timed.length > 0 ? Math.max(...timed.map(d => d.startTime + d.duration)) : undefined;
        const results = tests.map((test) : AssertionResult => ({
            title : test.name,
            ancestorTitles : ancestors(test),
            status : status(test),
            duration : test.diagnostic()?.duration ?? null,
            failureMessages : messages(test),
        }));
        const file : ProjectReportFile = {
            name : module.moduleId,
            ...(startTime !== undefined ? { startTime } : {}),
            ...(endTime !== undefined ? { endTime } : {}),
            assertionResults : [...results, ...errorsOutsideTests(module, results)],
        };
        report.testResults.push(file);
        reports.set(name, report);
    }
    return [...reports.values()];
}

/** "browser (chromium)" gives "browser-chromium". */
export function reportFileName(project : string) : string {
    const slug = project.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    return `${slug || "default"}.json`;
}

export default class ProjectReporter implements Reporter {
    onTestRunEnd(modules : ReadonlyArray<TestModule>) : void {
        const dir = process.env[PROJECT_REPORT_DIR_ENV];
        if (!dir) {
            console.warn(`[project-reporter] ${PROJECT_REPORT_DIR_ENV} is not set: no report written.`);
            return;
        }
        mkdirSync(dir, { recursive : true });
        for (const report of toProjectReports(modules)) {
            writeFileSync(path.join(dir, reportFileName(report.project)), JSON.stringify(report));
        }
    }
}
