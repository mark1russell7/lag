/**
 * A Vitest reporter that writes one JSON file for each project (each browser
 * instance is a project), in the shape of Vitest's JSON reporter that
 * `fromVitestJson` reads. Vitest's own JSON reporter puts the files of all
 * projects in one list, so a file that runs in four browsers comes four
 * times, with no project name.
 *
 * The collector gives it to Vitest by path:
 *   vitest run --reporter=default --reporter=<this file>
 * with LAG_PROJECT_REPORT_DIR set to the output folder.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Reporter, TestCase, TestModule } from "vitest/node";
import type { ProjectReport, ProjectReportFile } from "./model.js";

export const PROJECT_REPORT_DIR_ENV = "LAG_PROJECT_REPORT_DIR";

function ancestors(test : TestCase) : string[] {
    const titles : string[] = [];
    let parent = test.parent;
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

function messages(test : TestCase) : string[] {
    const result = test.result();
    const errors = result.errors?.map(error => error.stack ?? error.message) ?? [];
    // The reason of ctx.skip(condition, reason): the site shows it with the test
    if (result.state === "skipped" && result.note) return [`Skipped: ${result.note}`, ...errors];
    return errors;
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
        const file : ProjectReportFile = {
            name : module.moduleId,
            ...(startTime !== undefined ? { startTime } : {}),
            ...(endTime !== undefined ? { endTime } : {}),
            assertionResults : tests.map(test => ({
                title : test.name,
                ancestorTitles : ancestors(test),
                status : status(test),
                duration : test.diagnostic()?.duration ?? null,
                failureMessages : messages(test),
            })),
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
