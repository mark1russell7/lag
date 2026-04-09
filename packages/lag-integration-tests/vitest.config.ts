import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import path from "node:path";

export default defineConfig({
    resolve: {
        alias: {
            "@lag/lag": path.resolve(__dirname, "../lag/src"),
            "@lag/lag-worker": path.resolve(__dirname, "../lag-worker/src"),
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
