import type { CoverageCounts, RunReport } from "../../adapters/lag-report";

export type CoverageMetric = "lines" | "statements" | "functions" | "branches";

export const COVERAGE_METRICS : readonly CoverageMetric[] = ["lines", "statements", "functions", "branches"];

export const COVERAGE_LABELS : Readonly<Record<CoverageMetric, string>> = {
    lines : "Lines",
    statements : "Statements",
    functions : "Functions",
    branches : "Branches",
};

/** This function gives the covered percentage, from 0 to 100. It gives `undefined` if there is nothing to cover. */
export function percent(counts : CoverageCounts) : number | undefined {
    return counts.total === 0 ? undefined : (counts.covered / counts.total) * 100;
}

export type CoverageValues = Readonly<Record<CoverageMetric, number | undefined>>;

export type CoveragePackageRow = CoverageValues & {
    packageName : string;
    files : number;
};

export type CoverageFileRow = CoverageValues & {
    packageName : string;
    file : string;
};

function values(counts : Readonly<Record<CoverageMetric, CoverageCounts>>) : CoverageValues {
    return {
        lines : percent(counts.lines),
        statements : percent(counts.statements),
        functions : percent(counts.functions),
        branches : percent(counts.branches),
    };
}

export function coveragePackageRows(run : RunReport) : CoveragePackageRow[] {
    return run.coverage
        .map(report => ({ packageName : report.packageName, files : report.files.length, ...values(report.total) }))
        .sort((a, b) => a.packageName.localeCompare(b.packageName));
}

export function coverageFileRows(run : RunReport) : CoverageFileRow[] {
    return run.coverage.flatMap(report => report.files.map(file => ({
        packageName : report.packageName,
        file : file.file,
        ...values(file),
    })));
}
