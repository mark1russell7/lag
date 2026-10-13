/**
 * The `pnpm results` script does one run of the test program and writes the
 * results for the site.
 *
 * 1. The unit tests of @mark1russell7/lag (with coverage), @lag/load, @lag/report and
 *    @lag/scripts.
 * 2. The browser tests of @lag/integration-tests in every engine (the
 *    browser, cdp, bfcache and coi projects), one project at a time, as the
 *    CI workflow does (refer to `browser-projects.ts`). Then the overhead
 *    benchmark alone.
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
 * --soak, --e2e, --safari, --ios, --no-mutation, --keep-temp. With
 * `--projects=<names>`, step 2 operates only these browser projects (a JSON
 * array, or names with commas between them).
 *
 * Two options connect machines. `--export-reports=<dir>` writes the raw
 * reports, the measurements and the exit codes of the steps of this machine
 * to `<dir>`, and it writes no run. `--import-reports=<dir>` adds the reports
 * of `<dir>` and of each folder in `<dir>` to the run of this machine. For
 * example, each browser job of the Pages workflow tests one engine on its own
 * runner and exports its reports. The job of the site imports them.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, truncateSync, writeFileSync } from "node:fs";
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
import { BROWSER_PROJECTS, parseProjectList } from "./browser-projects.js";
import { PROJECT_REPORT_DIR_ENV } from "./project-reporter.js";
import { sessionLossRetry } from "./session-loss.js";
import {
    changedDuringRun,
    MUTATION_ORIGIN_FILE,
    mergeIndex,
    mutationOrigin,
    parseResultLines,
    parseStepCodes,
    runExitCode,
    runFile,
    runId,
    STEP_CODES_FILE,
    suiteMeta,
    toBudgets,
    toMeasurements,
    type ProjectReport,
    type ResultRecord,
    type StepCode,
} from "./model.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
// Forward slashes: Vitest resolves the reporter path as a module specifier
const reporter = path.join(here, "project-reporter.ts").replace(/\\/g, "/");
const outputDir = path.join(root, "packages/site/public/data/results");
const RESULTS_DIR_ENV = "LAG_RESULTS_DIR";

const flags = new Set(process.argv.slice(2));
const has = (flag : string) : boolean => flags.has(flag);
/** The value of an option `--name=<value>`. */
const option = (name : string) : string | undefined => {
    const prefix = `--${name}=`;
    return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length);
};
/** The value of an option `--name=<value>`, as an absolute path. */
const pathOption = (name : string) : string | undefined => {
    const value = option(name);
    return value ? path.resolve(process.cwd(), value) : undefined;
};
const exportDir = pathOption("export-reports");
const importDir = pathOption("import-reports");
const projectsValue = option("projects");
const browserProjects : readonly string[] = projectsValue === undefined ? BROWSER_PROJECTS : parseProjectList(projectsValue);

type Step = {
    title : string;
    packageName : string;
    /** The package folder, relative to the repository root. */
    dir : string;
    args : string[];
    /** More environment variables for the step. */
    env? : Record<string, string>;
    /** When true, a run that lost the session of the browser operates one more time (refer to `sessionLossRetry`). */
    retryOnSessionLoss? : boolean;
};

const steps : Step[] = [
    ...(has("--skip-unit") ? [] : [
        { title : "Unit tests and coverage of @mark1russell7/lag", packageName : "@mark1russell7/lag", dir : "packages/lag", args : ["--coverage"] },
        { title : "Unit tests of @lag/load", packageName : "@lag/load", dir : "packages/load", args : [] },
        { title : "Unit tests of @lag/report", packageName : "@lag/report", dir : "packages/report", args : [] },
        { title : "Unit tests of @lag/scripts", packageName : "@lag/scripts", dir : "packages/scripts", args : [] },
    ]),
    // One project at a time: the timing tests measure milliseconds, and the engines would use the CPU of each other
    ...(has("--skip-browser") ? [] : browserProjects.map(project => (
        { title : `Browser tests: ${project}`, packageName : "@lag/integration-tests", dir : "packages/lag-integration-tests", args : ["--project", project] }
    ))),
    // Alone, after the other browser tests: they would use the CPU that it measures
    ...(has("--skip-overhead") ? [] : [
        { title : "Overhead benchmark", packageName : "@lag/integration-tests", dir : "packages/lag-integration-tests", args : ["--project", "overhead"] },
    ]),
    ...(has("--soak") ? [{ title : "Soak test", packageName : "@lag/integration-tests", dir : "packages/lag-integration-tests", args : ["--project", "soak"] }] : []),
    ...(has("--e2e") ? [{ title : "E2E tests with the Grafana stack", packageName : "@lag/integration-tests", dir : "packages/lag-integration-tests", args : ["--project", "e2e"] }] : []),
    ...(has("--safari") ? [{ title : "Browser tests in Safari", packageName : "@lag/integration-tests", dir : "packages/lag-integration-tests", args : ["--project", "browser (safari)"], env : { LAG_SAFARI : "1" } }] : []),
    // A booted iOS Simulator is necessary. LAG_IOS_UDID selects it.
    ...(has("--ios") ? [{ title : "Browser tests in Safari on iOS", packageName : "@lag/integration-tests", dir : "packages/lag-integration-tests", args : ["--project", "browser (ios)"], env : { LAG_IOS : "1" }, retryOnSessionLoss : true }] : []),
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

/**
 * This function starts the Vitest of a package with Node, so that no shell
 * quotes the arguments. For a step with `retryOnSessionLoss`, it keeps the
 * output, and it gives the output after the end of the run.
 */
function runVitest(step : Step, reportDir : string, resultsDir : string) : { status : number; output : string } {
    const dir = path.join(root, step.dir);
    const vitest = path.join(dir, "node_modules/vitest/vitest.mjs");
    const args = [vitest, "run", ...step.args, "--reporter=default", `--reporter=${reporter}`];
    console.log(`\n=== ${step.title} (${step.dir}: vitest ${args.slice(1).join(" ")})\n`);
    const keep = step.retryOnSessionLoss === true;
    const result = spawnSync(process.execPath, args, {
        cwd : dir,
        stdio : keep ? ["inherit", "pipe", "pipe"] : "inherit",
        encoding : "utf8",
        maxBuffer : 256 * 1024 * 1024,
        env : { ...process.env, ...step.env, [PROJECT_REPORT_DIR_ENV] : reportDir, [RESULTS_DIR_ENV] : resultsDir },
    });
    const output = keep ? `${result.stdout ?? ""}${result.stderr ?? ""}` : "";
    if (keep) {
        process.stdout.write(result.stdout ?? "");
        process.stderr.write(result.stderr ?? "");
    }
    return { status : result.status ?? 1, output };
}

/**
 * This function operates a step. A step with `retryOnSessionLoss` operates
 * one more time when Safari lost its WebDriver session and no test failed.
 * The reports and the measurements of the second operation replace those of the first.
 */
function runStep(step : Step, reportDir : string, resultsDir : string) : number {
    const resultsFile = path.join(resultsDir, "results.jsonl");
    const resultsSize = existsSync(resultsFile) ? statSync(resultsFile).size : 0;
    const first = runVitest(step, reportDir, resultsDir);
    if (first.status === 0 || step.retryOnSessionLoss !== true) return first.status;
    const decision = sessionLossRetry(first.output);
    if (!decision.retry) return first.status;
    console.log(`::warning title=${step.title}: second run::${decision.reason}`);
    // As .github/scripts/test-ios.sh: the safaridriver of the first run continues after Vitest stops,
    // and it can keep the session of the simulator
    spawnSync("pkill", ["-x", "safaridriver"], { stdio : "inherit" });
    spawnSync("xcrun", ["simctl", "terminate", process.env["LAG_IOS_UDID"] || "booted", "com.apple.mobilesafari"], { stdio : "inherit" });
    spawnSync("sleep", ["5"], { stdio : "inherit" });
    rmSync(reportDir, { recursive : true, force : true });
    if (existsSync(resultsFile)) truncateSync(resultsFile, resultsSize);
    return runVitest(step, reportDir, resultsDir).status;
}

function suitesFrom(reportDir : string, packageName : string) : SuiteResult[] {
    if (!existsSync(reportDir)) return [];
    return readdirSync(reportDir)
        .filter(file => file.endsWith(".json") && file !== STEP_CODES_FILE)
        .flatMap((file) => {
            const report = readJson<ProjectReport>(path.join(reportDir, file));
            return report ? [fromVitestJson(report, suiteMeta(packageName, report.project, report.environment), root)] : [];
        });
}

/** This function copies the raw reports, the measurements and the exit codes of the steps of this machine to `dir` (--export-reports). */
function exportReports(dir : string, temp : string, resultsDir : string, stepCodes : readonly StepCode[]) : void {
    mkdirSync(dir, { recursive : true });
    writeFileSync(path.join(dir, STEP_CODES_FILE), `${JSON.stringify(stepCodes, null, 2)}\n`);
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

/** The reports of other machines (--import-reports): `dir` and each folder in it, for example one folder for each job. */
type Imported = { suites : SuiteResult[]; records : ResultRecord[]; stepCodes : StepCode[] };

function importReports(dir : string) : Imported {
    const imported : Imported = { suites : [], records : [], stepCodes : [] };
    if (!existsSync(dir)) {
        console.warn(`No reports to import: ${dir} does not exist.`);
        return imported;
    }
    const folders = [dir, ...readdirSync(dir).map(name => path.join(dir, name)).filter(folder => statSync(folder).isDirectory())];
    for (const folder of folders) {
        const suites = suitesFrom(folder, "@lag/integration-tests");
        const resultsFile = path.join(folder, "results.jsonl");
        const records = existsSync(resultsFile) ? parseResultLines(readFileSync(resultsFile, "utf8")) : [];
        const stepCodes = parseStepCodes(readJson<unknown>(path.join(folder, STEP_CODES_FILE)));
        if (suites.length === 0 && records.length === 0 && stepCodes.length === 0) continue;
        imported.suites.push(...suites);
        imported.records.push(...records);
        // The title tells the folder, thus the log shows the machine of a failed step
        imported.stepCodes.push(...stepCodes.map(step => ({ title : `${step.title} (${path.relative(dir, folder) || "."})`, code : step.code })));
        console.log(`Imported ${suites.length} suites from ${folder}.`);
    }
    return imported;
}

/**
 * The coverage of @mark1russell7/lag, only if the unit tests of this run wrote it. A
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
    return summary ? [fromIstanbulSummary(summary, "@mark1russell7/lag", root)] : [];
}

function mutationReports() : MutationReport[] {
    const dir = path.join(root, "packages/lag/reports/mutation");
    const file = path.join(dir, "mutation.json");
    if (has("--no-mutation") || !existsSync(file)) return [];
    const report = readJson<StrykerReport>(file);
    if (!report) return [];
    // The commit and the time of the Stryker run, usually from an earlier day than this run
    const origin = mutationOrigin(readJson<unknown>(path.join(dir, MUTATION_ORIGIN_FILE)), statSync(file).mtime);
    console.log(`Mutation report: ${path.relative(root, file)} from ${origin.createdAt}${origin.commit ? `, commit ${origin.commit.slice(0, 7)}` : ""}`);
    // Stryker names the files relative to the package
    const files = Object.fromEntries(Object.entries(report.files).map(([name, value]) => [path.resolve(root, "packages/lag", name), value]));
    return [fromStrykerReport({ files }, "@mark1russell7/lag", root, origin)];
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
        const code = runStep(step, reportDir, resultsDir);
        exitCodes.push([step.title, code]);
        const found = suitesFrom(reportDir, step.packageName);
        if (found.length === 0) console.warn(`No test report from "${step.title}" (exit code ${code}).`);
        suites.push(...found);
    });

    if (exportDir) {
        exportReports(exportDir, temp, resultsDir, exitCodes.map(([title, code]) => ({ title, code })));
        if (!has("--keep-temp")) rmSync(temp, { recursive : true, force : true });
        process.exitCode = runExitCode(0, [], exitCodes.map(([, code]) => code));
        return;
    }

    const resultsFile = path.join(resultsDir, "results.jsonl");
    const records : ResultRecord[] = existsSync(resultsFile) ? parseResultLines(readFileSync(resultsFile, "utf8")) : [];
    // The reports of other machines (--import-reports), for example each engine and Safari from macOS
    if (importDir) {
        const imported = importReports(importDir);
        suites.push(...imported.suites);
        records.push(...imported.records);
        exitCodes.push(...imported.stepCodes.map(({ title, code }) : [string, number] => [title, code]));
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
