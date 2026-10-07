import { describe, expect, it } from "vitest";
import { countStatuses } from "../adapters/lag-report";
import { parseRunReport } from "../results/validate";
import { SAMPLE_RUNS } from "./sample-results";

describe("sample results", () => {
    it("has two valid runs", () => {
        expect(SAMPLE_RUNS).toHaveLength(2);
        for (const { report } of SAMPLE_RUNS) expect(parseRunReport(report)).toBe(report);
    });

    it("covers Node and the three browser engines, with some failures", () => {
        const { report } = SAMPLE_RUNS[1]!;
        const environments = new Set(report.suites.map(suite => suite.environment));
        expect([...environments].sort()).toEqual(["chromium", "firefox", "node", "webkit"]);
        expect(countStatuses(report.suites).failed).toBe(3);
        expect(report.coverage.length).toBeGreaterThan(0);
        expect(report.mutation.length).toBeGreaterThan(0);
        expect(report.measurements.length).toBeGreaterThan(0);
        expect(report.budgets.some(budget => !budget.pass)).toBe(true);
    });

    it("is the same each time", () => {
        const values = SAMPLE_RUNS[0]!.report.measurements[0]!.values.slice(0, 3);
        expect(values.every(Number.isFinite)).toBe(true);
        expect(SAMPLE_RUNS[0]!.report.suites[0]!.files[0]!.tests[0]!.durationMs).toBeGreaterThan(0);
    });
});
