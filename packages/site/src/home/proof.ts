/**
 * The numbers of the proof strip of the home page. They come from the
 * newest run of the test program, the same data as the results section.
 */
import type { RunReport, RunSummary } from "../adapters/lag-report";
import { coveragePackageRows } from "../results/model/coverage";
import { compareEnvironments } from "../results/model/matrix";
import { mutationPackageRows } from "../results/model/mutation";

/** The npm package of the library. The mutation score and the coverage are the values of this package. */
export const LIBRARY_PACKAGE = "@mark1russell7/lag";

const BROWSER_LABELS : Readonly<Record<string, string>> = {
    chromium : "Chromium",
    chrome : "Chrome",
    edge : "Edge",
    firefox : "Firefox",
    webkit : "WebKit",
    safari : "Safari",
    ios : "Safari on iOS",
};

export type ProofNumbers = {
    runId : string;
    createdAt : string;
    commit : string | undefined;
    passed : number;
    failed : number;
    /** The browser setups of the browser tests, as names, in a fixed sequence. */
    browsers : readonly string[];
    /** The mutation score of the library, from 0 to 100. */
    mutationScore : number | undefined;
    /** The statement and branch coverage of the library, from 0 to 100. */
    statements : number | undefined;
    branches : number | undefined;
};

/** This function takes the numbers from the summary of a run and, if it loaded, the full run. */
export function proofNumbers(summary : RunSummary, run : RunReport | undefined) : ProofNumbers {
    const environments = run
        ? [...new Set(run.suites.filter(suite => suite.kind === "browser").map(suite => suite.environment))].sort(compareEnvironments)
        : [];
    const mutation = run ? mutationPackageRows(run).find(row => row.packageName === LIBRARY_PACKAGE) : undefined;
    const coverage = run ? coveragePackageRows(run).find(row => row.packageName === LIBRARY_PACKAGE) : undefined;
    return {
        runId : summary.id,
        createdAt : summary.createdAt,
        commit : summary.git?.commit,
        passed : summary.counts.passed,
        failed : summary.counts.failed,
        browsers : environments.map(environment => BROWSER_LABELS[environment] ?? environment),
        mutationScore : mutation?.score,
        statements : coverage?.statements,
        branches : coverage?.branches,
    };
}
