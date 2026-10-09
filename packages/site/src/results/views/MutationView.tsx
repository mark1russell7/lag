import { PlotFigure } from "../../components/PlotFigure/PlotFigure";
import { formatCount, formatDateTime, formatPercent, shortCommit } from "../../lib/format";
import { mutationChart, shortPath } from "../charts";
import { Meter } from "../components/Meter";
import { SortableTable, type Column } from "../components/SortableTable";
import { EmptySection } from "../components/States";
import {
    mutationFileRows,
    mutationOrigins,
    mutationPackageRows,
    type MutationFileRow,
    type MutationOriginRow,
    type MutationPackageRow,
} from "../model/mutation";
import { useRunContext } from "./run-context";
import styles from "./Results.module.css";

type CountKey = "killed" | "survived" | "noCoverage" | "timeout" | "other";

const COUNT_LABELS : Readonly<Record<CountKey, string>> = {
    killed : "Killed",
    survived : "Survived",
    noCoverage : "No coverage",
    timeout : "Timeout",
    other : "Other",
};

function countColumns<T extends Record<CountKey, number>>() : Array<Column<T, CountKey>> {
    return (Object.keys(COUNT_LABELS) as CountKey[]).map(key => ({
        key,
        label : COUNT_LABELS[key],
        align : "right" as const,
        render : (row : T) => row[key],
        sortValue : (row : T) => row[key],
    }));
}

/** A file with only compile errors, runtime errors or ignored mutants has no score: not 100%. */
const NO_SCORE = "No valid mutants";

const PACKAGE_COLUMNS : ReadonlyArray<Column<MutationPackageRow, "packageName" | "score" | "files" | CountKey>> = [
    { key : "packageName", label : "Package", rowHeader : true, render : (row) => <code>{row.packageName}</code>, sortValue : (row) => row.packageName },
    { key : "score", label : "Score", align : "right", render : (row) => <Meter value={row.score} emptyText={NO_SCORE} />, sortValue : (row) => row.score },
    { key : "files", label : "Files", align : "right", render : (row) => row.files, sortValue : (row) => row.files },
    ...countColumns<MutationPackageRow>(),
];

const FILE_COLUMNS : ReadonlyArray<Column<MutationFileRow, "file" | "score" | CountKey>> = [
    { key : "file", label : "File", rowHeader : true, render : (row) => <code>{row.file}</code>, sortValue : (row) => row.file },
    { key : "score", label : "Score", align : "right", render : (row) => <Meter value={row.score} emptyText={NO_SCORE} />, sortValue : (row) => row.score },
    ...countColumns<MutationFileRow>(),
];

/** The commit and the time of the Stryker run of one report. */
function OriginNote({ origin } : { origin : MutationOriginRow }) {
    const age = origin.daysBeforeRun === undefined || origin.daysBeforeRun === 0
        ? null
        : <> That is {formatCount(origin.daysBeforeRun, "day")} before this run.</>;
    return (
        <p className={styles.lead}>
            Stryker tested <code>{origin.packageName}</code>
            {origin.commit ? <> at the commit <code>{shortCommit(origin.commit)}</code></> : <> at an unknown commit</>}
            {origin.createdAt ? <> on {formatDateTime(origin.createdAt)}.</> : <>. The report has no time.</>}
            {age}
        </p>
    );
}

/** Mutation scores for each package and each file. */
export function MutationView() {
    const { run } = useRunContext();
    if (run.mutation.length === 0) return <EmptySection text="This run has no mutation testing data." />;

    const packages = mutationPackageRows(run);
    const files = mutationFileRows(run);
    return (
        <>
            <section className={styles.block} aria-labelledby="mutation-packages">
                <h2 id="mutation-packages">Mutation score by package</h2>
                {mutationOrigins(run).map(origin => <OriginNote key={origin.packageName} origin={origin} />)}
                <p className={styles.lead}>
                    The score is the number of mutants with the status <code>Killed</code> or <code>Timeout</code>, divided by the
                    number of valid mutants. A mutant with the status <code>Survived</code> is a change to the code that no
                    test found. A file without valid mutants, for example with only compile errors, has no score.
                </p>
                <SortableTable
                    label="Mutation score by package"
                    columns={PACKAGE_COLUMNS}
                    rows={packages}
                    rowKey={(row) => row.packageName}
                    initialSort={{ key : "packageName", direction : "ascending" }}
                />
            </section>
            <section className={styles.block} aria-labelledby="mutation-files">
                <h2 id="mutation-files">Mutation score by file</h2>
                <PlotFigure
                    title="Mutation score by file, the lowest score first"
                    description="One bar for each file, up to 20 files. The bar length is the mutation score."
                    options={mutationChart(files)}
                    table={{
                        columns : [
                            { key : "file", label : "File", format : (value) => shortPath(String(value)) },
                            { key : "score", label : "Score (%)", align : "right", format : (value) => formatPercent(value as number) },
                        ],
                        rows : files.filter(row => row.score !== undefined),
                    }}
                />
                <SortableTable
                    label="Mutation score by file"
                    columns={FILE_COLUMNS}
                    rows={files}
                    rowKey={(row) => `${row.packageName}:${row.file}`}
                    initialSort={{ key : "score", direction : "ascending" }}
                />
            </section>
        </>
    );
}
