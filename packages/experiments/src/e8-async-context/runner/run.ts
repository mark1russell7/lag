/**
 * The runner of experiment E8: the cost of an async context in the browser.
 *
 * 1. It builds the page once for each setup (A, B, C, D), for the
 *    measurements without minification, and for the sizes with it.
 * 2. It serves the builds on 127.0.0.1.
 * 3. For each engine, it does the rounds. Each round does one page run of
 *    each setup, in a different order in each round (refer to `plan.ts`).
 * 4. It writes the results as JSON. The default file is the data of the
 *    page "Local experiments" of the site.
 *
 * Options: `--rounds=<n>` (default 5), `--engines=chromium,firefox,webkit`,
 * `--setups=A,B,C,D`, `--out=<file>`, and `--quick` (short windows and one
 * round, only to examine the harness; its file goes to `dist/e8`).
 *
 * Use it from the root of the repository: `pnpm experiment:e8`. The
 * workspace packages must be built (`tsc -b`) before the run.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SETUP_IDS, SETUP_LABELS, type SetupFacts, type SetupId } from "../shared/types.js";
import { bundleSize, buildSetup } from "./builds.js";
import { machine, packageVersions, PACKAGE_DIR, REPO_ROOT } from "./environment.js";
import { FULL_TIMING, QUICK_TIMING, launch, measureRun } from "./measure.js";
import { roundOrder } from "./plan.js";
import { serveDirectory } from "./server.js";
import { renderTables } from "./report.js";
import { ENGINES, summarize, type BundleSize, type E8Results, type Engine, type RunResult } from "./summary.js";

const DEFAULT_OUT = path.join(REPO_ROOT, "packages/site/content/research/local-experiments.e8.json");
const WORK_DIR = path.join(PACKAGE_DIR, "dist/e8");

function option(name : string) : string | undefined {
    const prefix = `--${name}=`;
    return process.argv.slice(2).find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

function listOption<T extends string>(name : string, allowed : readonly T[]) : T[] {
    const value = option(name);
    if (value === undefined) return [...allowed];
    const items = value.split(",").map(item => item.trim()).filter(item => item !== "");
    for (const item of items) {
        if (!allowed.includes(item as T)) throw new Error(`--${name}: "${item}" is not one of ${allowed.join(", ")}.`);
    }
    return items as T[];
}

const quick = process.argv.includes("--quick");
const rounds = Number(option("rounds") ?? (quick ? 1 : 5));
const engines = listOption<Engine>("engines", ENGINES);
const setups = listOption<SetupId>("setups", SETUP_IDS);
const out = path.resolve(option("out") ?? (quick ? path.join(WORK_DIR, "quick.json") : DEFAULT_OUT));
const timing = quick ? QUICK_TIMING : FULL_TIMING;

if (!Number.isInteger(rounds) || rounds < 1) throw new Error("--rounds must be a positive integer.");
if (!setups.includes("A")) throw new Error("--setups must contain A: the runner compares each setup with A.");

const log = (message : string) : void => {
    console.log(`[e8 ${new Date().toISOString().slice(11, 19)}] ${message}`);
};

function format(value : number | undefined) : string {
    return value === undefined || !Number.isFinite(value) ? "-" : value.toFixed(2);
}

async function main() : Promise<void> {
    const started = new Date();
    log(`Build of the setups ${setups.join(", ")}`);
    const bundles : BundleSize[] = [];
    for (const setup of setups) {
        await buildSetup(setup, "measure", path.join(WORK_DIR, "measure", setup));
        const sizeDir = path.join(WORK_DIR, "size", setup);
        await buildSetup(setup, "size", sizeDir);
        bundles.push(bundleSize(setup, sizeDir));
    }

    const server = await serveDirectory(path.join(WORK_DIR, "measure"));
    const runs : RunResult[] = [];
    const browsers : Partial<Record<Engine, string>> = {};
    const facts : Partial<Record<Engine, Partial<Record<SetupId, SetupFacts>>>> = {};
    const partial = path.join(WORK_DIR, "partial.json");
    try {
        for (const engine of engines) {
            const browser = await launch(engine);
            browsers[engine] = browser.version();
            await browser.close();
            log(`${engine} ${browsers[engine]}`);
            for (let round = 0; round < rounds; round++) {
                const order = roundOrder(setups, round);
                log(`${engine}, round ${round + 1} of ${rounds}: ${order.join(" ")}`);
                for (const [position, setup] of order.entries()) {
                    const run = await measureRun({
                        engine,
                        setup,
                        round,
                        position,
                        url : `${server.origin}/${setup}/index.html`,
                        timing,
                        otlpRequests : server.otlpRequests,
                    });
                    runs.push(run);
                    (facts[engine] ??= {})[setup] ??= run.facts;
                    log(`  ${setup}: drift median ${format(run.metrics["drift.medianMs"])} ms, ` +
                        `idle task ${format(run.metrics["idle.monitors.taskMsPerS"])} ms/s, ` +
                        `operations ${format(run.metrics["workload.operations.totalMs"])} ms, ` +
                        `machine CPU ${format(run.metrics["machine.cpuBusyPercent"])} %, errors ${run.errors.length}`);
                    for (const error of run.errors) log(`    error: ${error}`);
                    // A file after each run: a stopped run keeps its data
                    mkdirSync(WORK_DIR, { recursive : true });
                    writeFileSync(partial, `${JSON.stringify({ runs }, null, 2)}\n`);
                }
            }
        }
    } finally {
        await server.close();
    }

    const result : E8Results = {
        experiment : "E8",
        title : "The cost of an async context in the browser",
        quick,
        started : started.toISOString(),
        ended : new Date().toISOString(),
        machine : machine(),
        packages : packageVersions(),
        browsers,
        timing,
        rounds,
        setups : setups.map(id => ({ id, label : SETUP_LABELS[id] })),
        facts,
        bundles,
        summary : summarize(runs),
        runs,
    };
    mkdirSync(path.dirname(out), { recursive : true });
    writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
    console.log(renderTables(result));
    log(`Results: ${path.relative(REPO_ROOT, out)}`);
}

main().catch((error : unknown) => {
    console.error(error);
    process.exit(1);
});
