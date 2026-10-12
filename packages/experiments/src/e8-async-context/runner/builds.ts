/**
 * The Vite builds of the page. All setups build the same page source. Only
 * three parts change:
 *
 * - the module of `#e8-setup`, which selects the context manager;
 * - in setups A and C, `@opentelemetry/context-zone` becomes a module
 *   without zone.js;
 * - in setup C, the Vite plugin of async-browser-context transforms each
 *   module, also the dependencies.
 *
 * The runner measures builds without minification, so that the long
 * animation frame entries show the function names. The bundle sizes come
 * from minified builds of the same source.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build, type InlineConfig, type Plugin } from "vite";
import { asyncContext } from "async-browser-context/vite";
import type { SetupId } from "../shared/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PAGE_DIR = path.resolve(here, "../page");

const SETUP_MODULES : Readonly<Record<SetupId, string>> = {
    A : "a-stack.ts",
    B : "b-zone.ts",
    C : "c-async-context.ts",
    D : "d-stack-with-zone.ts",
};

/** The setups without zone.js: their builds replace `@opentelemetry/context-zone`. */
const WITHOUT_ZONE : ReadonlySet<SetupId> = new Set(["A", "C"]);

export type BuildKind = "measure" | "size";

/** The Vite config of one setup. */
export function setupConfig(setup : SetupId, kind : BuildKind, outDir : string) : InlineConfig {
    const plugins : Plugin[] = setup === "C" ? [asyncContext()] : [];
    return {
        configFile : false,
        envFile : false,
        root : PAGE_DIR,
        base : "./",
        logLevel : "warn",
        plugins,
        resolve : {
            // The plugin adds `import ... from "async-browser-context/runtime"` to each module that it
            // transforms. With pnpm, the folders of the other packages (lag, otel-ts) cannot resolve
            // that import. `dedupe` resolves it from the folder of the page, for all modules.
            ...(setup === "C" ? { dedupe : ["async-browser-context"] } : {}),
            alias : [
                { find : "#e8-setup", replacement : path.join(PAGE_DIR, "setups", SETUP_MODULES[setup]) },
                ...(WITHOUT_ZONE.has(setup)
                    ? [{ find : /^@opentelemetry\/context-zone$/, replacement : path.join(PAGE_DIR, "zone-free-context-zone.ts") }]
                    : []),
            ],
        },
        build : {
            outDir,
            emptyOutDir : true,
            minify : kind === "size",
            reportCompressedSize : false,
            sourcemap : false,
        },
    };
}

/** The size of the JavaScript of one build, in bytes. */
export type BundleSize = {
    setup : SetupId;
    /** The JavaScript of the page, without the worker of lag. */
    pageBytes : number;
    pageGzipBytes : number;
    /** The worker of lag. It is the same in each setup, because the plugins of the page do not change the worker. */
    workerBytes : number;
    workerGzipBytes : number;
    /** True if the JavaScript of the page contains zone.js. */
    containsZone : boolean;
    /** True if the JavaScript of the page contains the runtime of async-browser-context. */
    containsAsyncContext : boolean;
};

/** This function measures the JavaScript files of a build. gzip uses the default level of zlib (6). */
export function bundleSize(setup : SetupId, outDir : string) : BundleSize {
    const assets = path.join(outDir, "assets");
    const files = readdirSync(assets).filter(file => file.endsWith(".js"));
    const size = { setup, pageBytes : 0, pageGzipBytes : 0, workerBytes : 0, workerGzipBytes : 0, containsZone : false, containsAsyncContext : false };
    for (const file of files) {
        const content = readFileSync(path.join(assets, file));
        const gzip = gzipSync(content).length;
        if (file.includes("worker")) {
            size.workerBytes += content.length;
            size.workerGzipBytes += gzip;
            continue;
        }
        size.pageBytes += content.length;
        size.pageGzipBytes += gzip;
        const text = content.toString("utf8");
        size.containsZone ||= text.includes("Zone.__symbol__") || text.includes("__zone_symbol__");
        size.containsAsyncContext ||= text.includes("async-browser-context/store/v1");
    }
    return size;
}

/** This function builds one setup. */
export async function buildSetup(setup : SetupId, kind : BuildKind, outDir : string) : Promise<void> {
    await build(setupConfig(setup, kind, outDir));
}
