/**
 * pnpm results: runs the test program and writes the results for the site.
 *
 * 1. The unit tests of @lag/core (with coverage), @lag/load, @lag/report and
 *    @lag/scripts.
 * 2. The browser tests of @lag/integration-tests in every engine (the
 *    browser, cdp and coi projects), then the overhead benchmark alone.
 * 3. The tests of @lag/site (Node and Chromium).
 * 4. With --soak and --e2e: the soak test and the e2e tests.
 *
 * Each run uses `project-reporter.ts`, which writes one Vitest JSON report
 * for each project. The browser tests write their measurements and budgets
 * to $LAG_RESULTS_DIR/results.jsonl. The collector converts all of this with
 * the @lag/report converters, adds the latest Stryker report if it exists,
 * and writes packages/site/public/data/results/: index.json and
 * runs/<run ID>.json.
 *
 * Options: --skip-unit, --skip-browser, --skip-overhead, --skip-site,
 * --soak, --e2e, --no-mutation, --keep-temp.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    SCHEMA_VERSION,
    countStatuses,
    fromIstanbulSummary,
    fromStrykerReport,
    fromVitestJson,
    type CoverageReport,
    type GitInfo,
    type IstanbulSummary,
    type MutationReport,
    type RunReport,
    type StrykerReport,
    type SuiteResult,
} from "@lag/report";
import { PROJECT_REPORT_DIR_ENV } from "./project-reporter.js";
import { mergeIndex, parseResultLines, runFile, runId, suiteMeta, toBudgets, toMeasurements, type ProjectReport, type ResultRecord } from "./model.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
// Forward slashes: Vitest resolves the reporter path as a module specifier
const reporter = path.join(here, "project-reporter.ts").replace(/\\/g, "/");
const outputDir = path.join(root, "packages/site/public/data/results");
const RESULTS_DIR_ENV = "LAG_RESULTS_DIR";

const flags = new Set(process.argv.slice(2));
const has = (flag : string) : boolean => flags.has(flag);

type Step = {
    title : string;
    packageName : string;
    /** The package folder, relative to the repository root. */
    dir : string;
    args : string[];
};

const steps : Step[] = [
    ...(has("--skip-unit") ? [] : [
        { title : "Unit tests and coverage of @lag/core", packageName : "@lag/core", dir : "packages/lag", args : ["--coverage"] },
        { title : "Unit tests of @lag/load", packageName : "@lag/load", dir : "packages/load", args : [] },
        { title : "Unit tests of @lag/report", packageName : "@lag/report", dir : "packages/report", args : [] },
        { title : "Unit tests of @lag/scripts", packageName : "@lag/scripts", dir : "packages/scripts", args : [] },
    ]),
    ...(has("--skip-browser") ? [] : [
        { title : "Browser tests in every engine", packageName : "@lag/integration-tests", dir : "packages/lag-integration-tests", args : ["--project", "browser", "--project", "cdp", "--project", "coi"] },
    ]),
    // Alone, after the other browser tests: they would use the CPU that it measures
    ...(has("--skip-overhead") ? [] : [
        { title : "Overhead benchmark", packageName : "@lag/integration-tests", dir : "packages/lag-integration-tests", args : ["--project", "overhead"] },
    ]),
    ...(has("--soak") ? [{ title : "Soak test", packageName : "@lag/integration-tests", dir : "packages/lag-integration-tests", args : ["--project", "soak"] }] : []),
    ...(has("--e2e") ? [{ title : "E2E tests with the Grafana stack", packageName : "@lag/integration-tests", dir : "packages/lag-integration-tests", args : ["--project", "e2e"] }] : []),
    ...(has("--skip-site") ? [] : [
        { title : "Tests of @lag/site", packageName : "@lag/site", dir : "packages/site", args : [] },
    ]),
];

function git(...args : string[]) : string | undefined {
    const result = spawnSync("git", args, { cwd : root, encoding : "utf8" });
    return result.status === 0 ? result.stdout.trim() : undefined;
}

function gitInfo() : GitInfo | undefined {
    const commit = git("rev-parse", "HEAD");
    if (!commit) return undefined;
    // CI checks out a detached HEAD: GitHub gives the branch name
    const branch = process.env["GITHUB_HEAD_REF"] || process.env["GITHUB_REF_NAME"] || git("rev-parse", "--abbrev-ref", "HEAD") || "HEAD";
    return { commit, branch };
}

function readJson<T>(file : string) : T | undefined {
    try {
        return JSON.parse(readFileSync(file, "utf8")) as T;
    } catch {
        return undefined;
    }
}

/** Runs Vitest of a package with Node, so that no shell quotes the arguments. */
function runVitest(step : Step, reportDir : string, resultsDir : string) : number {
    const dir = path.join(root, step.dir);
    const vitest = path.join(dir, "node_modules/vitest/vitest.mjs");
    const args = [vitest, "run", ...step.args, "--reporter=default", `--reporter=${reporter}`];
    console.log(`\n=== ${step.title} (${step.dir}: vitest ${args.slice(1).join(" ")})\n`);
    const result = spawnSync(process.execPath, args, {
        cwd : dir,
        stdio : "inherit",
        env : { ...process.env, [PROJECT_REPORT_DIR_ENV] : reportDir, [RESULTS_DIR_ENV] : resultsDir },
    });
    return result.status ?? 1;
}

function suitesFrom(reportDir : string, packageName : string) : SuiteResult[] {
    if (!existsSync(reportDir)) return [];
    return readdirSync(reportDir)
        .filter(file => file.endsWith(".json"))
        .flatMap((file) => {
            const report = readJson<ProjectReport>(path.join(reportDir, file));
            return report ? [fromVitestJson(report, suiteMeta(packageName, report.project, report.environment), root)] : [];
        });
}

function coverageReports() : CoverageReport[] {
    const summary = readJson<IstanbulSummary>(path.join(root, "packages/lag/coverage/coverage-summary.json"));
    return summary ? [fromIstanbulSummary(summary, "@lag/core", root)] : [];
}

function mutationReports() : MutationReport[] {
    const file = path.join(root, "packages/lag/reports/mutation/mutation.json");
    if (has("--no-mutation") || !existsSync(file)) return [];
    const report = readJson<StrykerReport>(file);
    if (!report) return [];
    console.log(`Mutation report: ${path.relative(root, file)} from ${statSync(file).mtime.toISOString()}`);
    // Stryker names the files relative to the package
    const files = Object.fromEntries(Object.entries(report.files).map(([name, value]) => [path.resolve(root, "packages/lag", name), value]));
    return [fromStrykerReport({ files }, "@lag/core", root)];
}

function main() : void {
    const createdAt = new Date();
    const info = gitInfo();
    const id = runId(createdAt, info?.commit);
    const temp = mkdtempSync(path.join(os.tmpdir(), "lag-results-"));
    const resultsDir = path.join(temp, "results");
    mkdirSync(resultsDir, { recursive : true });
    console.log(`Run ${id}${info ? ` (${info.branch} ${info.commit.slice(0, 7)})` : ""}; temporary files in ${temp}`);

    const suites : SuiteResult[] = [];
    const exitCodes : Array<[string, number]> = [];
    steps.forEach((step, index) => {
        const reportDir = path.join(temp, "reports", String(index));
        const code = runVitest(step, reportDir, resultsDir);
        exitCodes.push([step.title, code]);
        const found = suitesFrom(reportDir, step.packageName);
        if (found.length === 0) console.warn(`No test report from "${step.title}" (exit code ${code}).`);
        suites.push(...found);
    });

    const resultsFile = path.join(resultsDir, "results.jsonl");
    const records : ResultRecord[] = existsSync(resultsFile) ? parseResultLines(readFileSync(resultsFile, "utf8")) : [];
    const run : RunReport = {
        schemaVersion : SCHEMA_VERSION,
        id,
        createdAt : createdAt.toISOString(),
        ...(info ? { git : info } : {}),
        suites : suites.sort((a, b) => a.id.localeCompare(b.id)),
        coverage : coverageReports(),
        mutation : mutationReports(),
        measurements : toMeasurements(records, "@lag/integration-tests"),
        budgets : toBudgets(records),
    };

    mkdirSync(path.join(outputDir, "runs"), { recursive : true });
    writeFileSync(path.join(outputDir, runFile(id)), `${JSON.stringify(run)}\n`);
    const index = mergeIndex(readJson<unknown>(path.join(outputDir, "index.json")), run);
    writeFileSync(path.join(outputDir, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
    if (!has("--keep-temp")) rmSync(temp, { recursive : true, force : true });

    const counts = countStatuses(run.suites);
    console.log(`\nWrote ${path.relative(root, path.join(outputDir, runFile(id)))} and the index (${index.runs.length} runs).`);
    console.log(`Suites: ${run.suites.length}; tests: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped, ${counts.todo} to do; ` +
        `coverage reports: ${run.coverage.length}; mutation reports: ${run.mutation.length}; measurements: ${run.measurements.length}; budgets: ${run.budgets.length} ` +
        `(${run.budgets.filter(b => !b.pass).length} failed).`);
    for (const [title, code] of exitCodes) if (code !== 0) console.log(`Exit code ${code}: ${title}`);
    process.exitCode = counts.failed > 0 || run.budgets.some(b => !b.pass) ? 1 : 0;
}

main();
