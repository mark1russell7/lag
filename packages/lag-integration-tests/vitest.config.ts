import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type TestProjectInlineConfiguration } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { resultCommands } from "./commands/results.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourceOf = (packageDir : string) : string => path.resolve(here, "..", packageDir, "src");

type Environment = "chromium" | "firefox" | "webkit" | "chrome";
type Provider = ReturnType<typeof playwright>;
type Instance = NonNullable<NonNullable<NonNullable<TestProjectInlineConfiguration["test"]>["browser"]>["instances"]>[number];

const COMMANDS = { ...resultCommands };

function instance(project : string, environment : Environment, provider? : Provider, e2e = false) : Instance {
    const chrome = environment === "chrome" ? playwright({ launchOptions : { channel : "chrome" } }) : undefined;
    const chosen = provider ?? chrome;
    return {
        browser : environment === "chrome" ? "chromium" : environment,
        name : `${project} (${environment})`,
        provide : { environment, e2e },
        ...(chosen ? { provider : chosen } : {}),
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
            // With the Grafana stack (pnpm test:e2e): the Mimir checks are required
            project("e2e", ["src/lag-monitors.test.ts", "src/stress.test.ts"], [
                instance("e2e", "chromium", undefined, true),
            ]),
        ],
    },
});
