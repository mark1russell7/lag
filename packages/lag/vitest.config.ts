import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        // Stryker copies the package into .stryker-tmp; a stopped run can leave the copy there
        exclude: [...configDefaults.exclude, "**/.stryker-tmp/**"],
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: ["src/**/*.test.ts", "src/test-utils.ts", "src/vitals/test-fakes.ts", "**/.stryker-tmp/**"],
            // json-summary writes coverage/coverage-summary.json for the results collector (pnpm results)
            reporter: [["text", { skipFull: true }], "text-summary", "json-summary", "html"],
            reportsDirectory: "coverage",
            // The values measured on 2026-10-07 (statements 96.14, branches 88.97, functions 94.55,
            // lines 97.57) minus 1 percentage point, rounded down. Raise them when the coverage rises.
            thresholds: {
                statements: 95,
                branches: 87,
                functions: 93,
                lines: 96,
            },
        },
    },
});
