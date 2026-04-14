import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import path from "node:path";

export default defineConfig({
    resolve: {
        alias: {
            "@lag/core": path.resolve(__dirname, "../lag/src"),
            "@lag/worker": path.resolve(__dirname, "../lag-worker/src"),
        },
    },
    optimizeDeps: {
        include: ["@mark1russell7/otel-ts"],
    },
    test: {
        browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
        },
        testTimeout: 60_000,
        globals: true,
    },
});
