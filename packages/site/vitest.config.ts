import { playwright } from "@vitest/browser-playwright";
import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

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
                        instances : [{ browser : "chromium" }],
                    },
                },
            },
        ],
    },
}));
