import { Link } from "react-router";
import type { StatusCounts } from "../../adapters/lag-report";
import { PlotFigure } from "../../components/PlotFigure/PlotFigure";
import { ScrollTable } from "../../components/ScrollTable/ScrollTable";
import { StatusIcon } from "../../components/StatusIcon/StatusIcon";
import { formatCount, formatMs } from "../../lib/format";
import { durationChart } from "../charts";
import { StatTiles } from "../components/StatTiles";
import { durationBins } from "../model/durations";
import { environmentMatrix, type MatrixCell } from "../model/matrix";
import { failingTests, runCounts, slowestTests, testDurations, totalSuiteDuration, totalTests, type TestRow } from "../model/tests";
import { useRunContext } from "./run-context";
import styles from "./Results.module.css";

function cellText(counts : StatusCounts) : string {
    const total = totalTests(counts);
    const parts = [counts.failed > 0 ? `${counts.failed} failed of ${total}` : `${counts.passed} passed`];
    if (counts.skipped > 0) parts.push(`${counts.skipped} skipped`);
    if (counts.todo > 0) parts.push(`${counts.todo} to do`);
    return parts.join(", ");
}

function MatrixCellView({ cell, packageName, environment } : { cell : MatrixCell | undefined; packageName : string; environment : string }) {
    if (!cell) return <span className={styles.muted}>No suite</span>;
    const failed = cell.counts.failed > 0;
    const query = new URLSearchParams({ q : packageName, env : environment });
    return (
        <Link to={`tests?${query.toString()}`} className={styles.cellLink} data-failed={failed ? "true" : undefined}>
            <StatusIcon kind={failed ? "failed" : "passed"} showLabel={false} />
            <span>{cellText(cell.counts)}</span>
        </Link>
    );
}

const MESSAGE_LINES = 8;

function FailureItem({ row } : { row : TestRow }) {
    const message = row.failureMessages.join("\n\n");
    const lines = message.split("\n");
    const short = lines.slice(0, MESSAGE_LINES).join("\n");
    return (
        <li className={styles.failure}>
            <p className={styles.failureName}>
                <StatusIcon kind="failed" showLabel={false} /> {row.fullName}
            </p>
            <p className={styles.failureMeta}>
                <code>{row.file}</code> in {row.packageName}, {row.environment}
            </p>
            {message ? <pre className={styles.message}>{short}</pre> : <p className={styles.muted}>The test has no failure message.</p>}
            {lines.length > MESSAGE_LINES ? (
                <details className={styles.more}>
                    <summary>Show the full message</summary>
                    <pre className={styles.message}>{message}</pre>
                </details>
            ) : null}
        </li>
    );
}

/** The summary of a run: totals, the package × environment matrix, failures, slow tests and durations. */
export function RunOverview() {
    const { run } = useRunContext();
    const counts = runCounts(run);
    const matrix = environmentMatrix(run);
    const failures = failingTests(run);
    const slowest = slowestTests(run, 10);
    const bins = durationBins(testDurations(run));

    return (
        <>
            <StatTiles
                label="Totals of this run"
                stats={[
                    { label : "Passed", kind : "passed", value : String(counts.passed) },
                    { label : "Failed", kind : "failed", value : String(counts.failed) },
                    { label : "Skipped", kind : "skipped", value : String(counts.skipped) },
                    { label : "To do", kind : "todo", value : String(counts.todo) },
                    { label : "Suites", value : String(run.suites.length) },
                    { label : "Suite time", value : formatMs(totalSuiteDuration(run)), detail : "The sum of all suites" },
                ]}
            />

            <section className={styles.block} aria-labelledby="matrix-heading">
                <h2 id="matrix-heading">Packages and environments</h2>
                <p className={styles.lead}>Each cell shows the tests of one package in one environment. Select a cell to see its tests.</p>
                <ScrollTable label="Packages and environments">
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col">Package</th>
                                {matrix.environments.map(environment => <th key={environment} scope="col">{environment}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {matrix.rows.map(row => (
                                <tr key={row.packageName}>
                                    <th scope="row"><code>{row.packageName}</code></th>
                                    {row.cells.map((cell, index) => {
                                        const environment = matrix.environments[index] ?? "";
                                        return (
                                            <td key={environment}>
                                                <MatrixCellView cell={cell} packageName={row.packageName} environment={environment} />
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </ScrollTable>
            </section>

            <section className={styles.block} aria-labelledby="failures-heading">
                <h2 id="failures-heading">Failed tests</h2>
                {failures.length === 0 ? (
                    <p><StatusIcon kind="passed" showLabel={false} /> No test failed in this run.</p>
                ) : (
                    <>
                        <p className={styles.lead}>{formatCount(failures.length, "test")} failed.</p>
                        <ol className={styles.failures}>
                            {failures.map(row => <FailureItem key={row.key} row={row} />)}
                        </ol>
                    </>
                )}
            </section>

            <section className={styles.block} aria-labelledby="slowest-heading">
                <h2 id="slowest-heading">Slowest tests</h2>
                <ScrollTable label="Slowest tests">
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col">Test</th>
                                <th scope="col">Package and environment</th>
                                <th scope="col" data-align="right">Duration</th>
                            </tr>
                        </thead>
                        <tbody>
                            {slowest.map(row => (
                                <tr key={row.key}>
                                    <th scope="row">
                                        <span className={styles.testName}>{row.fullName}</span>
                                        <code className={styles.testFile}>{row.file}</code>
                                    </th>
                                    <td><code>{row.packageName}</code> in {row.environment}</td>
                                    <td data-align="right">{formatMs(row.durationMs)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </ScrollTable>
            </section>

            <section className={styles.block} aria-labelledby="durations-heading">
                <h2 id="durations-heading">Test durations</h2>
                {bins.length === 0 ? <p className={styles.muted}>No test ran.</p> : (
                    <PlotFigure
                        title="Number of tests in each duration range"
                        description="A histogram of the durations of the tests that ran. Each bar is one duration range; the ranges grow in steps of 1, 2 and 5."
                        hideTitle
                        options={durationChart(bins)}
                        table={{
                            columns : [
                                { key : "label", label : "Duration" },
                                { key : "count", label : "Tests", align : "right" },
                            ],
                            rows : bins,
                        }}
                    />
                )}
            </section>
        </>
    );
}
