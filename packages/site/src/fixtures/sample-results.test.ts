import { mulberry32 } from "@mark1russell7/rigor-generators";
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

/** The generator of the site before the move to `@mark1russell7/rigor-generators`, word for word. */
function createRandom(seed : number) : () => number {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6D2B79F5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

describe("mulberry32 of @mark1russell7/rigor-generators and the copy of the site", () => {
    it("gives the same sequence for each seed", () => {
        const seeds = [0, 1, 7, 42, 2 ** 31, 2 ** 32 - 1, 2 ** 32, -1, -42, 1.5, 123_456.789, Number.NaN];
        for (let seed = 0; seed < 2000; seed += 13) seeds.push(seed * 2_654_435_761);
        for (const seed of seeds) {
            const copy = createRandom(seed);
            const home = mulberry32(seed);
            for (let i = 0; i < 500; i++) expect(home(), `seed ${seed}, draw ${i}`).toBe(copy());
        }
    });
});
