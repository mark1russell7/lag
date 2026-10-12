/**
 * The await probe of E8: a short check of the cost of one `await` step and
 * of one microtask. It builds the probe page three times: without an async
 * context (`plain`), with the plugin and the patches of async-browser-context
 * (`async-context`), and with zone.js (`zone`). Then it measures 50,000
 * sequential steps in each form, in Chromium and in Firefox with three
 * settings of the async stacks. When Firefox records async stacks, it records
 * one for each promise reaction.
 *
 * Use it from the package folder: `pnpm e8:await-probe`. The probe prints a
 * Markdown table. It writes no file in the repository.
 */
import path from "node:path";
import { build } from "vite";
import { asyncContext } from "async-browser-context/vite";
import { chromium, firefox, type Browser, type Page } from "playwright";
import { PAGE_DIR } from "./builds.js";
import { PACKAGE_DIR } from "./environment.js";
import { serveDirectory } from "./server.js";
import { median } from "./stats.js";

const PROBE_DIR = path.join(PAGE_DIR, "await-probe");
const OUT_DIR = path.join(PACKAGE_DIR, "dist/e8-await-probe");
const COUNT = 50_000;
const REPETITIONS = 7;

const BUILDS = ["plain", "async-context", "zone"] as const;
type ProbeBuild = (typeof BUILDS)[number];

type ProbeGlobal = { awaitProbe? : { ready : boolean; variants : string[]; run(variant : string, count : number) : Promise<number> } };

type BrowserSetup = { name : string; launch : () => Promise<Browser> };

const BROWSERS : readonly BrowserSetup[] = [
    { name : "Chromium", launch : () => chromium.launch({ channel : "chromium", headless : true }) },
    { name : "Firefox", launch : () => firefox.launch({ headless : true }) },
    { name : "Firefox, asyncstack off", launch : () => firefox.launch({ headless : true, firefoxUserPrefs : { "javascript.options.asyncstack" : false } }) },
    // Async stacks only while a debugger observes the page: the setting of a release build of Firefox
    { name : "Firefox, async stacks only for a debuggee", launch : () => firefox.launch({ headless : true, firefoxUserPrefs : { "javascript.options.asyncstack_capture_debuggee_only" : true } }) },
];

async function buildProbe(kind : ProbeBuild) : Promise<void> {
    await build({
        configFile : false,
        envFile : false,
        root : PROBE_DIR,
        base : "./",
        logLevel : "warn",
        // The plugin does not transform native.ts: its loops stay native async functions
        plugins : kind === "async-context" ? [asyncContext({ exclude : /[\\/]await-probe[\\/]native\.ts$/ })] : [],
        resolve : kind === "async-context" ? { dedupe : ["async-browser-context"] } : {},
        define : { "import.meta.env.VITE_PROBE_BUILD" : JSON.stringify(kind) },
        build : { outDir : path.join(OUT_DIR, kind), emptyOutDir : true, minify : false, reportCompressedSize : false },
    });
}

async function openProbe(browser : Browser, url : string) : Promise<Page> {
    const page = await (await browser.newContext()).newPage();
    await page.goto(url);
    await page.waitForFunction(() => (globalThis as unknown as ProbeGlobal).awaitProbe?.ready === true);
    return page;
}

async function main() : Promise<void> {
    for (const kind of BUILDS) await buildProbe(kind);
    const server = await serveDirectory(OUT_DIR);
    const rows : string[][] = [];
    try {
        for (const setup of BROWSERS) {
            const browser = await setup.launch();
            try {
                const cases : Array<{ kind : ProbeBuild; variant : string; page : Page; times : number[] }> = [];
                for (const kind of BUILDS) {
                    const page = await openProbe(browser, `${server.origin}/${kind}/index.html`);
                    const variants = await page.evaluate(() => (globalThis as unknown as ProbeGlobal).awaitProbe!.variants);
                    for (const variant of variants) cases.push({ kind, variant, page, times : [] });
                }
                // One run to warm up, then the measured runs, in turns
                for (let repetition = 0; repetition <= REPETITIONS; repetition++) {
                    for (const item of cases) {
                        const ms = await item.page.evaluate(([variant, count]) => (globalThis as unknown as ProbeGlobal).awaitProbe!.run(variant, count), [item.variant, COUNT] as const);
                        if (repetition > 0) item.times.push(ms);
                    }
                }
                // A microtask chain compares with the chain of the build `plain`, an await with a native `await` there
                const plain = (variant : string) : number => median(cases.find(item => item.kind === "plain" && item.variant === variant)!.times);
                for (const item of cases) {
                    const ms = median(item.times);
                    const base = plain(item.variant === "queue-microtask" ? "queue-microtask" : "native-await");
                    rows.push([setup.name, item.kind, `\`${item.variant}\``, ms.toFixed(1), ((ms * 1_000) / COUNT).toFixed(2), `×${(ms / base).toFixed(1)}`]);
                }
                console.log(`${setup.name} ${browser.version()}: done`);
            } finally {
                await browser.close();
            }
        }
    } finally {
        await server.close();
    }
    console.log(`\n${COUNT} sequential steps, median of ${REPETITIONS} runs\n`);
    console.log("| Browser | Build | Form | Time (ms) | Each step (µs) | Compared with the native form of the build `plain` |");
    console.log("| --- | --- | --- | --- | --- | --- |");
    for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

main().catch((error : unknown) => {
    console.error(error);
    process.exit(1);
});
