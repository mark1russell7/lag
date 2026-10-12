import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";
import { BROWSER_HOST, freePorts } from "./build/free-port";

// The browser server gets a free port, not the default port of Vitest (refer to build/free-port.ts)
const browserPort = await freePorts()();

export default mergeConfig(viteConfig, defineConfig({
    test : {
        projects : [
            {
                extends : true,
                test : {
                    name : "node",
                    environment : "node",
                    include : ["build/**/*.test.ts", "src/**/*.test.{ts,tsx}"],
                    exclude : ["**/node_modules/**", "**/*.browser.test.{ts,tsx}"],
                },
            },
            {
                extends : true,
                test : {
                    name : "browser",
                    include : ["src/**/*.browser.test.{ts,tsx}"],
                    testTimeout : 60_000,
                    browser : {
                        enabled : true,
                        headless : true,
                        provider : playwright(),
                        api : { host : BROWSER_HOST, port : browserPort, strictPort : true },
                        instances : [{ browser : "chromium" }],
                    },
                },
            },
        ],
    },
}));
