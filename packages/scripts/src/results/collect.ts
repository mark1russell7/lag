/**
 * The `pnpm results` script does one run of the test program and writes the
 * results for the site.
 *
 * 1. The unit tests of @lag/core (with coverage), @lag/load, @lag/report and
 *    @lag/scripts.
 * 2. The browser tests of @lag/integration-tests in every engine (the
 *    browser, cdp and coi projects), then the overhead benchmark alone.
 * 3. The tests of @lag/site (Node and Chromium).
 * 4. With --soak and --e2e: the soak test and the e2e tests. With --safari:
 *    the browser tests in Safari (only on macOS, through safaridriver). With
 *    --ios: the browser tests in Safari in the iOS Simulator.
 *
 * Each run uses `project-reporter.ts`, which writes one Vitest JSON report
 * for each project. The browser tests write their measurements and budgets
 * to `$LAG_RESULTS_DIR/results.jsonl`. The collector converts all of this
 * with the @lag/report converters and adds the latest Stryker report if it
 * exists. Then it writes `index.json` and `runs/<run ID>.json` in
 * `packages/site/public/data/results/`.
 *
 * Options: --skip-unit, --skip-browser, --skip-overhead, --skip-site,
 * --soak, --e2e, --safari, --ios, --no-mutation, --keep-temp.
 *
 * Two options connect two machines. `--export-reports=<dir>` writes the raw
 * reports and the measurements of this machine to `<dir>`, and it writes no
 * run. `--import-reports=<dir>` adds the reports of `<dir>` to the run of
 * this machine. For example, a macOS job tests Safari and exports its
 * reports, and the Linux job of the site imports them.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
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
import {
    changedDuringRun,
    mergeIndex,
    parseResultLines,
    runExitCode,
    runFile,
    runId,
    suiteMeta,
    toBudgets,
    toMeasurements,
    type ProjectReport,
    type ResultRecord,
} from "./model.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
// Forward slashes: Vitest resolves the reporter path as a module specifier
const reporter = path.join(here, "project-reporter.ts").replace(/\\/g, "/");
const outputDir = path.join(root, "packages/site/public/data/results");
const RESULTS_DIR_ENV = "LAG_RESULTS_DIR";

const flags = new Set(process.argv.slice(2));
const has = (flag : string) : boolean => flags.has(flag);
/** The value of an option `--name=<value>`, as an absolute path. */
const pathOption = (name : string) : string | undefined => {
    const prefix = `--${name}=`;
    const value = process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length);
    return value ? path.resolve(process.cwd(), value) : undefined;
};
const exportDir = pathOption("export-reports");
const importDir = pathOption("import-reports");

type Step = {
    title : string;
    packageName : string;
    /** The package folder, relative to the repository root. */
    dir : string;
    args : string[];
    /** More environment variables for the step. */
    env? : Record<string, string>;
};

const steps : Step[] = [
    ...(has("--skip-unit") ? [] : [
        { title : "Unit tests and coverage of @lag/core", packageName : "@lag/core", dir : "packages/lag", args : ["--coverage"] },
        { title : "Unit tests of @lag/load", packageName : "@lag/load", dir : "packages/load", args : [] },
        { title : "Unit tests of @lag/report", packageName : "@lag/report", dir : "packages/report", args : [] },
        { title : "Unit tests of @lag/scripts", packageName : "@lag/scripts", dir : "packages/scripts", args : [] },
    ]),
    ...(has("--skip-browser") ? [] : [
        { title : "Browser tests in every engine", packageName : "@lag/integration-tests", dir : "packages/lag-integration-tests", args : ["--project", "browser", "--project", "cdp", "--project", "bfcache", "--project", "coi"] },
    ]),
    // Alone, after the other browser tests: they would use the CPU that it measures
    ...(has("--skip-overhead") ? [] : [
        { title : "Overhead benchmark", packageName : "@lag/integration-tests", dir : "packages/lag-integration-tests", args : ["--project", "overhead"] },
    ]),
    ...(has("--soak") ? [{ title : "Soak test", packageName : "@lag/integration-tests", dir : "packages/lag-integration-tests", args : ["--project", "soak"] }] : []),
    ...(has("--e2e") ? [{ title : "E2E tests with the Grafana stack", packageName : "@lag/integration-tests", dir : "packages/lag-integration-tests", args : ["--project", "e2e"] }] : []),
    ...(has("--safari") ? [{ title : "Browser tests in Safari", packageName : "@lag/integration-tests", dir : "packages/lag-integration-tests", args : ["--project", "browser (safari)"], env : { LAG_SAFARI : "1" } }] : []),
    // A booted iOS Simulator is necessary. LAG_IOS_UDID selects it.
    ...(has("--ios") ? [{ title : "Browser tests in Safari on iOS", packageName : "@lag/integration-tests", dir : "packages/lag-integration-tests", args : ["--project", "browser (ios)"], env : { LAG_IOS : "1" } }] : []),
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

/** This function starts the Vitest of a package with Node, so that no shell quotes the arguments. */
function runVitest(step : Step, reportDir : string, resultsDir : string) : number {
    const dir = path.join(root, step.dir);
    const vitest = path.join(dir, "node_modules/vitest/vitest.mjs");
    const args = [vitest, "run", ...step.args, "--reporter=default", `--reporter=${reporter}`];
    console.log(`\n=== ${step.title} (${step.dir}: vitest ${args.slice(1).join(" ")})\n`);
    const result = spawnSync(process.execPath, args, {
        cwd : dir,
        stdio : "inherit",
        env : { ...process.env, ...step.env, [PROJECT_REPORT_DIR_ENV] : reportDir, [RESULTS_DIR_ENV] : resultsDir },
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

/** This function copies the raw reports and the measurements of this machine to `dir` (--export-reports). */
function exportReports(dir : string, temp : string, resultsDir : string) : void {
    mkdirSync(dir, { recursive : true });
    const reportsRoot = path.join(temp, "reports");
    let count = 0;
    for (const step of existsSync(reportsRoot) ? readdirSync(reportsRoot) : []) {
        for (const file of readdirSync(path.join(reportsRoot, step)).filter(name => name.endsWith(".json"))) {
            copyFileSync(path.join(reportsRoot, step, file), path.join(dir, `${step}-${file}`));
            count++;
        }
    }
    const resultsFile = path.join(resultsDir, "results.jsonl");
    if (existsSync(resultsFile)) copyFileSync(resultsFile, path.join(dir, "results.jsonl"));
    console.log(`\nExported ${count} reports to ${dir}.`);
}

/**
 * The coverage of @lag/core, only if the unit tests of this run wrote it. A
 * file from an earlier run (for example with --skip-unit) is not a result of
 * this run.
 */
function coverageReports(runStart : Date) : CoverageReport[] {
    const file = path.join(root, "packages/lag/coverage/coverage-summary.json");
    if (!existsSync(file)) return [];
    const modified = statSync(file).mtime;
    if (!changedDuringRun(modified, runStart)) {
        console.log(`Coverage: ${path.relative(root, file)} is from ${modified.toISOString()}, before this run. The run has no coverage report.`);
        return [];
    }
    const summary = readJson<IstanbulSummary>(file);
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

    if (exportDir) {
        exportReports(exportDir, temp, resultsDir);
        if (!has("--keep-temp")) rmSync(temp, { recursive : true, force : true });
        process.exitCode = runExitCode(0, [], exitCodes.map(([, code]) => code));
        return;
    }

    const resultsFile = path.join(resultsDir, "results.jsonl");
    const records : ResultRecord[] = existsSync(resultsFile) ? parseResultLines(readFileSync(resultsFile, "utf8")) : [];
    // The reports of another machine (--import-reports), for example Safari from macOS
    if (importDir && existsSync(importDir)) {
        const imported = suitesFrom(importDir, "@lag/integration-tests");
        suites.push(...imported);
        const importedResults = path.join(importDir, "results.jsonl");
        if (existsSync(importedResults)) records.push(...parseResultLines(readFileSync(importedResults, "utf8")));
        console.log(`Imported ${imported.length} suites from ${importDir}.`);
    } else if (importDir) {
        console.warn(`No reports to import: ${importDir} does not exist.`);
    }
    const run : RunReport = {
        schemaVersion : SCHEMA_VERSION,
        id,
        createdAt : createdAt.toISOString(),
        ...(info ? { git : info } : {}),
        suites : suites.sort((a, b) => a.id.localeCompare(b.id)),
        coverage : coverageReports(createdAt),
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
    // A step can fail without a failed test, for example when Vitest cannot start
    process.exitCode = runExitCode(counts.failed, run.budgets, exitCodes.map(([, code]) => code));
}

main();
