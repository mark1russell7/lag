import { useId, useState } from "react";
import { PlotFigure } from "../../components/PlotFigure/PlotFigure";
import { formatPercent } from "../../lib/format";
import { coverageChart } from "../charts";
import { Meter } from "../components/Meter";
import { SortableTable, type Column } from "../components/SortableTable";
import { EmptySection } from "../components/States";
import {
    COVERAGE_LABELS,
    COVERAGE_METRICS,
    coverageFileRows,
    coveragePackageRows,
    type CoverageFileRow,
    type CoverageMetric,
    type CoveragePackageRow,
} from "../model/coverage";
import { useRunContext } from "./run-context";
import styles from "./Results.module.css";

type PackageKey = "packageName" | "files" | CoverageMetric;
type FileKey = "file" | "packageName" | CoverageMetric;

function metricColumns<T extends Record<CoverageMetric, number | undefined>>() : Array<Column<T, CoverageMetric>> {
    return COVERAGE_METRICS.map(metric => ({
        key : metric,
        label : COVERAGE_LABELS[metric],
        align : "right" as const,
        render : (row : T) => <Meter value={row[metric]} />,
        sortValue : (row : T) => row[metric],
    }));
}

const PACKAGE_COLUMNS : ReadonlyArray<Column<CoveragePackageRow, PackageKey>> = [
    { key : "packageName", label : "Package", rowHeader : true, render : (row) => <code>{row.packageName}</code>, sortValue : (row) => row.packageName },
    { key : "files", label : "Files", align : "right", render : (row) => row.files, sortValue : (row) => row.files },
    ...metricColumns<CoveragePackageRow>(),
];

const FILE_COLUMNS : ReadonlyArray<Column<CoverageFileRow, FileKey>> = [
    { key : "file", label : "File", rowHeader : true, render : (row) => <code>{row.file}</code>, sortValue : (row) => row.file },
    { key : "packageName", label : "Package", render : (row) => <code>{row.packageName}</code>, sortValue : (row) => row.packageName },
    ...metricColumns<CoverageFileRow>(),
];

/** Coverage for each package and each file. */
export function CoverageView() {
    const { run } = useRunContext();
    const [metric, setMetric] = useState<CoverageMetric>("lines");
    const [packageName, setPackageName] = useState("");
    const metricId = useId();
    const packageId = useId();

    if (run.coverage.length === 0) return <EmptySection text="This run has no coverage data." />;

    const packages = coveragePackageRows(run);
    const files = coverageFileRows(run).filter(row => packageName === "" || row.packageName === packageName);

    return (
        <>
            <section className={styles.block} aria-labelledby="coverage-packages">
                <h2 id="coverage-packages">Coverage by package</h2>
                <div className={styles.filters}>
                    <div className={styles.field}>
                        <label htmlFor={metricId}>Metric in the chart</label>
                        <select id={metricId} className="control" value={metric} onChange={(event) => setMetric(event.target.value as CoverageMetric)}>
                            {COVERAGE_METRICS.map(key => <option key={key} value={key}>{COVERAGE_LABELS[key]}</option>)}
                        </select>
                    </div>
                </div>
                <PlotFigure
                    title={`${COVERAGE_LABELS[metric]} coverage by package`}
                    description={`One bar for each package. The bar length is the percentage of ${COVERAGE_LABELS[metric].toLowerCase()} that the tests run.`}
                    options={coverageChart(packages, metric)}
                    table={{
                        columns : [
                            { key : "packageName", label : "Package" },
                            { key : metric, label : `${COVERAGE_LABELS[metric]} (%)`, align : "right", format : (value) => formatPercent(value as number | undefined) },
                        ],
                        rows : packages,
                    }}
                />
                <SortableTable
                    label="Coverage by package"
                    columns={PACKAGE_COLUMNS}
                    rows={packages}
                    rowKey={(row) => row.packageName}
                    initialSort={{ key : "packageName", direction : "ascending" }}
                />
            </section>

            <section className={styles.block} aria-labelledby="coverage-files">
                <h2 id="coverage-files">Coverage by file</h2>
                <p className={styles.lead}>Select a column header to sort the table. The lowest line coverage is first.</p>
                <div className={styles.filters}>
                    <div className={styles.field}>
                        <label htmlFor={packageId}>Package</label>
                        <select id={packageId} className="control" value={packageName} onChange={(event) => setPackageName(event.target.value)}>
                            <option value="">All</option>
                            {packages.map(row => <option key={row.packageName} value={row.packageName}>{row.packageName}</option>)}
                        </select>
                    </div>
                </div>
                <SortableTable
                    label="Coverage by file"
                    columns={FILE_COLUMNS}
                    rows={files}
                    rowKey={(row) => `${row.packageName}:${row.file}`}
                    initialSort={{ key : "lines", direction : "ascending" }}
                />
            </section>
        </>
    );
}
