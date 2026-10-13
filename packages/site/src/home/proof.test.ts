import { describe, expect, it } from "vitest";
import { summarizeRun } from "../adapters/lag-report";
import { SAMPLE_RUNS } from "../fixtures/sample-results";
import { proofNumbers } from "./proof";

const { file, report } = SAMPLE_RUNS[0]!;
const summary = summarizeRun(report, file);

describe("proofNumbers", () => {
    it("takes the test counts, the browsers, the mutation score and the coverage of the library from a run", () => {
        const numbers = proofNumbers(summary, report);
        expect(numbers.runId).toBe(report.id);
        expect(numbers.commit).toBe(report.git?.commit);
        expect(numbers.passed).toBe(summary.counts.passed);
        expect(numbers.failed).toBe(1);
        // The benchmark suite is not a browser test, and Chromium has two suites
        expect(numbers.browsers).toEqual(["Chromium", "Firefox", "WebKit"]);
        expect(numbers.mutationScore).toBe(report.mutation[0]!.score);
        expect(numbers.statements).toBeGreaterThan(50);
        expect(numbers.branches).toBeGreaterThan(50);
    });

    it("gives the counts of the summary while the full run loads", () => {
        const numbers = proofNumbers(summary, undefined);
        expect(numbers.passed).toBe(summary.counts.passed);
        expect(numbers.browsers).toEqual([]);
        expect(numbers.mutationScore).toBeUndefined();
        expect(numbers.statements).toBeUndefined();
    });

    it("names the iOS simulator, and keeps an unknown setup by its name", () => {
        const suites = [
            { ...report.suites[0]!, kind : "browser" as const, environment : "ios" },
            { ...report.suites[0]!, kind : "browser" as const, environment : "chrome" },
            { ...report.suites[0]!, kind : "browser" as const, environment : "servo" },
        ];
        expect(proofNumbers(summary, { ...report, suites }).browsers).toEqual(["Chrome", "Safari on iOS", "servo"]);
    });
});
