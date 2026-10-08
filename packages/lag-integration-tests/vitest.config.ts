import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type TestProjectInlineConfiguration } from "vitest/config";
import type { Plugin } from "vite";
import { playwright } from "@vitest/browser-playwright";
import { webdriverio } from "@vitest/browser-webdriverio";
import { cdpCommands } from "./commands/cdp.js";
import { resultCommands } from "./commands/results.js";
import { mimirCommands } from "./commands/mimir.js";
import { topLevelPageCommands } from "./commands/top-level-page.js";
import { probeSocketCommands } from "./commands/probe-socket.js";
import { peerPageCommands } from "./commands/peer-page.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceOf = (packageDir : string) : string => path.resolve(here, "..", packageDir, "src");

type Environment = "chromium" | "firefox" | "webkit" | "chrome" | "safari";
type Provider = ReturnType<typeof playwright>;
type Instance = NonNullable<NonNullable<NonNullable<TestProjectInlineConfiguration["test"]>["browser"]>["instances"]>[number];

/** The duration of the soak test. Set LAG_SOAK_MS to change it. */
const SOAK_MS = Number(process.env["LAG_SOAK_MS"] ?? 180_000);

/** The block of the page that experiment E7 closes during its block. Set LAG_E7_CLOSE_BLOCK_MS to change it. */
const E7_CLOSE_BLOCK_MS = Number(process.env["LAG_E7_CLOSE_BLOCK_MS"] ?? 20_000);

const COMMANDS = { ...cdpCommands, ...resultCommands, ...mimirCommands, ...topLevelPageCommands, ...probeSocketCommands, ...peerPageCommands };

/**
 * Chromium in the new headless mode (Chrome for Testing). The default
 * headless shell has no `measureUserAgentSpecificMemory()` and does not hide
 * a page that is behind another page. Chrome stable closes the Vitest
 * connection when a page freezes, so the CDP tests use this build.
 */
const newHeadlessChromium = (args : string[] = []) : Provider =>
    playwright({ launchOptions : { channel : "chromium", ...(args.length > 0 ? { args } : {}) } });

/** Chromium with the back/forward cache. Playwright turns off the cache by default with this switch. */
const chromiumWithBackForwardCache = () : Provider =>
    playwright({ launchOptions : { channel : "chromium", ignoreDefaultArgs : ["--disable-back-forward-cache"] } });

/**
 * This plugin sends COOP and COEP with every response, so the page is
 * cross-origin isolated. A plugin is necessary because the browser server of
 * a project replaces the project's `server` options (Vitest 4.1). Thus,
 * `server.headers` works only in the root config. `enforce: "pre"` puts the
 * middleware before the middleware of Vitest that sends the test pages.
 */
function crossOriginIsolation() : Plugin {
    return {
        name : "lag:cross-origin-isolation",
        enforce : "pre",
        configureServer(server) {
            server.middlewares.use((_request, response, next) => {
                response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
                response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
                next();
            });
        },
    };
}

function instance(project : string, environment : Environment, provider? : Provider, e2e = false) : Instance {
    const chrome = environment === "chrome" ? playwright({ launchOptions : { channel : "chrome" } }) : undefined;
    const chosen = provider ?? chrome;
    return {
        browser : environment === "chrome" ? "chromium" : environment,
        name : `${project} (${environment})`,
        provide : { environment, e2e, soakMs : SOAK_MS, e7CloseBlockMs : E7_CLOSE_BLOCK_MS, platform : process.platform },
        ...(chosen ? { provider : chosen } : {}),
    };
}

/**
 * Safari on macOS, through safaridriver (WebDriver). The project exists only
 * with LAG_SAFARI=1, because only macOS has Safari. Safari has no headless
 * mode, and safaridriver permits one session at a time.
 */
function safariProject() : TestProjectInlineConfiguration {
    return {
        extends : true,
        test : {
            name : "safari",
            include : ["src/*.test.ts"],
            fileParallelism : false,
            browser : {
                enabled : true,
                headless : false,
                provider : webdriverio(),
                commands : COMMANDS,
                instances : [{ browser : "safari", name : "browser (safari)", provide : { environment : "safari", e2e : false, soakMs : SOAK_MS, e7CloseBlockMs : E7_CLOSE_BLOCK_MS, platform : process.platform } }],
            },
        },
    };
}

/**
 * Safari on iOS in the iOS Simulator, through safaridriver (experiment). The
 * project exists only with LAG_IOS=1 on macOS with Xcode. LAG_IOS_UDID
 * selects a booted simulator.
 */
function iosProject() : TestProjectInlineConfiguration {
    const udid = process.env["LAG_IOS_UDID"];
    return {
        extends : true,
        test : {
            name : "ios",
            include : ["src/*.test.ts"],
            fileParallelism : false,
            browser : {
                enabled : true,
                headless : false,
                provider : webdriverio({
                    // safaridriver can time out while it waits for Safari in the simulator
                    connectionRetryTimeout : 600_000,
                    connectionRetryCount : 10,
                    // The safari:* capabilities of safaridriver are not in the types of WebdriverIO
                    capabilities : { platformName : "iOS", "safari:useSimulator" : true, ...(udid ? { "safari:deviceUDID" : udid } : {}) } as Record<string, unknown>,
                }),
                commands : COMMANDS,
                instances : [{ browser : "safari", name : "browser (ios)", provide : { environment : "ios", e2e : false, soakMs : SOAK_MS, e7CloseBlockMs : E7_CLOSE_BLOCK_MS, platform : process.platform } }],
            },
        },
    };
}

function project(name : string, include : string[], instances : Instance[], test : NonNullable<TestProjectInlineConfiguration["test"]> = {}, extra : Omit<TestProjectInlineConfiguration, "test"> = {}) : TestProjectInlineConfiguration {
    return {
        extends : true,
        ...extra,
        test : {
            ...test,
            name,
            include,
            browser : {
                enabled : true,
                headless : true,
                provider : playwright(),
                commands : COMMANDS,
                instances,
            },
        },
    };
}

export default defineConfig({
    resolve : {
        alias : {
            "@lag/core" : sourceOf("lag"),
            "@lag/worker" : sourceOf("lag-worker"),
            "@lag/load" : sourceOf("load"),
        },
    },
    optimizeDeps : {
        // Pre-bundle every dependency that a test imports, so that Vite does
        // not reload the page in the middle of a run
        include : ["@mark1russell7/otel-ts", "web-vitals", "web-vitals/attribution"],
    },
    test : {
        testTimeout : 60_000,
        globals : true,
        // Vitest reads the connect timeout of the browser only from the root config. In the iOS
        // Simulator, safaridriver needed up to 131 s and more than one try to open the first session.
        ...(process.env["LAG_IOS"] === "1" ? { browser : { connectTimeout : 600_000 } } : {}),
        projects : [
            // Every test in every engine. The Chromium-only tests skip themselves elsewhere (src/features.ts).
            // The files of one engine run one after another: the timing tests measure milliseconds, and 28
            // parallel pages with busy loops oversubscribe the CPU. The four engines still run in parallel.
            project("browser", ["src/*.test.ts"], [
                instance("browser", "chromium"),
                instance("browser", "firefox"),
                instance("browser", "webkit"),
                instance("browser", "chrome"),
            ], { fileParallelism : false }),
            // Chromium only: page freezing, hidden pages, CPU throttling and virtual compute pressure through CDP
            project("cdp", ["src/cdp/**/*.test.ts"], [
                instance("cdp", "chromium", newHeadlessChromium()),
            ], { fileParallelism : false }),
            // Chromium only: the back/forward cache with the library in two pages of the origin
            project("bfcache", ["src/bfcache/**/*.test.ts"], [
                instance("bfcache", "chromium", chromiumWithBackForwardCache()),
            ], { fileParallelism : false }),
            // A cross-origin-isolated page: shared memory, the fine clock and measureUserAgentSpecificMemory()
            project("coi", ["src/coi/**/*.test.ts"], [
                // ForceEagerMeasureMemory: measureUserAgentSpecificMemory() resolves at once, not at the next GC
                instance("coi", "chromium", newHeadlessChromium(["--enable-blink-features=ForceEagerMeasureMemory"])),
                instance("coi", "firefox"),
                instance("coi", "webkit"),
            ], {}, { plugins : [crossOriginIsolation()] }),
            // The overhead benchmark: alone, so that no other test uses the CPU
            project("overhead", ["src/overhead/**/*.test.ts"], [
                instance("overhead", "chromium", newHeadlessChromium()),
            ], { fileParallelism : false, testTimeout : 300_000 }),
            // Opt-in: all monitors for LAG_SOAK_MS (default 3 minutes)
            project("soak", ["src/soak/**/*.test.ts"], [
                instance("soak", "chromium", newHeadlessChromium()),
            ], { fileParallelism : false, testTimeout : SOAK_MS + 120_000 }),
            // With the Grafana stack (pnpm test:e2e): the Mimir checks are required
            project("e2e", ["src/lag-monitors.test.ts", "src/stress.test.ts"], [
                instance("e2e", "chromium", undefined, true),
            ]),
            // Safari on macOS (LAG_SAFARI=1): the browser tests in the real Safari
            ...(process.env["LAG_SAFARI"] === "1" ? [safariProject()] : []),
            // Safari on iOS in the iOS Simulator (LAG_IOS=1, experiment)
            ...(process.env["LAG_IOS"] === "1" ? [iosProject()] : []),
        ],
    },
});
