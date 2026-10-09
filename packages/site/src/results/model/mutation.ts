import type { MutantStatus, MutationReport, RunReport } from "../../adapters/lag-report";

export type MutantCounts = {
    killed : number;
    survived : number;
    noCoverage : number;
    timeout : number;
    /** Compile errors, runtime errors and ignored mutants. They do not count in the score. */
    other : number;
    total : number;
};

export type MutationFileRow = MutantCounts & {
    packageName : string;
    file : string;
    /** No score: the file has no valid mutants, for example only compile errors. */
    score : number | undefined;
};

export type MutationPackageRow = MutantCounts & {
    packageName : string;
    score : number | undefined;
    files : number;
};

function mutantCounts(counts : Partial<Record<MutantStatus, number>>) : MutantCounts {
    const killed = counts.Killed ?? 0;
    const survived = counts.Survived ?? 0;
    const noCoverage = counts.NoCoverage ?? 0;
    const timeout = counts.Timeout ?? 0;
    const other = (counts.CompileError ?? 0) + (counts.RuntimeError ?? 0) + (counts.Ignored ?? 0);
    return { killed, survived, noCoverage, timeout, other, total : killed + survived + noCoverage + timeout + other };
}

function packageCounts(report : MutationReport) : MutantCounts {
    const sum = { killed : 0, survived : 0, noCoverage : 0, timeout : 0, other : 0, total : 0 };
    for (const file of report.files) {
        const counts = mutantCounts(file.counts);
        sum.killed += counts.killed;
        sum.survived += counts.survived;
        sum.noCoverage += counts.noCoverage;
        sum.timeout += counts.timeout;
        sum.other += counts.other;
        sum.total += counts.total;
    }
    return sum;
}

export function mutationPackageRows(run : RunReport) : MutationPackageRow[] {
    return run.mutation
        .map(report => ({ packageName : report.packageName, score : report.score, files : report.files.length, ...packageCounts(report) }))
        .sort((a, b) => a.packageName.localeCompare(b.packageName));
}

/** One row for each mutated file, the lowest score first, and the files without a score last. */
export function mutationFileRows(run : RunReport) : MutationFileRow[] {
    return run.mutation
        .flatMap(report => report.files.map(file => ({
            packageName : report.packageName,
            file : file.file,
            score : file.score,
            ...mutantCounts(file.counts),
        })))
        .sort((a, b) => (a.score ?? Number.POSITIVE_INFINITY) - (b.score ?? Number.POSITIVE_INFINITY) || a.file.localeCompare(b.file));
}

const DAY_MS = 86_400_000;

/** The origin of one mutation report: the commit and the time of its Stryker run. */
export type MutationOriginRow = {
    packageName : string;
    commit : string | undefined;
    createdAt : string | undefined;
    /** The whole days from the Stryker run to the run of the tests, or undefined without a time. */
    daysBeforeRun : number | undefined;
};

/**
 * The commit and the time of the Stryker run of each mutation report. The
 * mutation tests operate each week, thus a report is usually older than the
 * run that shows it.
 */
export function mutationOrigins(run : RunReport) : MutationOriginRow[] {
    return run.mutation
        .map((report) : MutationOriginRow => {
            const reportTime = report.createdAt === undefined ? Number.NaN : Date.parse(report.createdAt);
            const runTime = Date.parse(run.createdAt);
            return {
                packageName : report.packageName,
                commit : report.commit,
                createdAt : report.createdAt,
                daysBeforeRun : Number.isNaN(reportTime) || Number.isNaN(runTime) ? undefined : Math.max(0, Math.floor((runTime - reportTime) / DAY_MS)),
            };
        })
        .sort((a, b) => a.packageName.localeCompare(b.packageName));
}
