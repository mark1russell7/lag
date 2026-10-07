import { countStatuses, type RunReport, type StatusCounts, type SuiteResult } from "../../adapters/lag-report";

export type MatrixCell = {
    counts : StatusCounts;
    suites : readonly SuiteResult[];
};

export type MatrixRow = {
    packageName : string;
    /** One cell for each environment, in the order of `environments`. Undefined: no suite. */
    cells : ReadonlyArray<MatrixCell | undefined>;
};

export type EnvironmentMatrix = {
    environments : readonly string[];
    rows : readonly MatrixRow[];
};

const KNOWN_ORDER = ["node", "chromium", "chrome", "edge", "firefox", "webkit", "safari"];

/** Node first, then the browser engines in a fixed order, then other names in alphabetical order. */
export function compareEnvironments(a : string, b : string) : number {
    const rankA = KNOWN_ORDER.indexOf(a);
    const rankB = KNOWN_ORDER.indexOf(b);
    if (rankA >= 0 && rankB >= 0) return rankA - rankB;
    if (rankA >= 0) return -1;
    if (rankB >= 0) return 1;
    return a.localeCompare(b);
}

/** The test counts of each package in each environment. */
export function environmentMatrix(run : RunReport) : EnvironmentMatrix {
    const environments = [...new Set(run.suites.map(suite => suite.environment))].sort(compareEnvironments);
    const packages = [...new Set(run.suites.map(suite => suite.packageName))].sort((a, b) => a.localeCompare(b));
    const rows = packages.map((packageName) : MatrixRow => ({
        packageName,
        cells : environments.map((environment) => {
            const suites = run.suites.filter(suite => suite.packageName === packageName && suite.environment === environment);
            return suites.length === 0 ? undefined : { counts : countStatuses(suites), suites };
        }),
    }));
    return { environments, rows };
}
