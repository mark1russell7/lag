import { Link } from "react-router";
import type { RunIndex } from "../../adapters/lag-report";
import { DataTableDisclosure } from "../../components/DataTable/DataTable";
import { PlotFigure } from "../../components/PlotFigure/PlotFigure";
import { ScrollTable } from "../../components/ScrollTable/ScrollTable";
import { StatusIcon, statusLabel } from "../../components/StatusIcon/StatusIcon";
import { SITE_NAME } from "../../app/site";
import { formatDateTime, shortCommit } from "../../lib/format";
import { useAsync } from "../../lib/use-async";
import { useThemeColors } from "../../theme/colors";
import { runLabel, runTrendChart, statusColors } from "../charts";
import { ChartLegend } from "../components/ChartLegend";
import { ErrorState, Loading, NoResults } from "../components/States";
import { STATUS_ORDER } from "../model/tests";
import { runTrend, sortRunsNewestFirst } from "../model/trend";
import { useReportSource } from "../ReportSourceContext";
import styles from "./Results.module.css";

function RunList({ index } : { index : RunIndex }) {
    const runs = sortRunsNewestFirst(index.runs);
    const trend = runTrend(index);
    const theme = useThemeColors();
    const colors = statusColors(theme);
    return (
        <>
            <section className={styles.block} aria-labelledby="trend-heading">
                <h2 id="trend-heading">Test counts by run</h2>
                <ChartLegend
                    label="Test status"
                    items={STATUS_ORDER.map(status => ({ label : status, color : colors[status], kind : status }))}
                />
                <PlotFigure
                    title="Test counts by run, stacked by status"
                    description="One bar for each run, the oldest run on the left. Each bar has a part for each status; failed tests are at the bottom."
                    hideTitle
                    options={runTrendChart(trend)}
                />
                <DataTableDisclosure
                    title="Test counts by run"
                    spec={{
                        columns : [
                            { key : "run", label : "Run" },
                            ...STATUS_ORDER.map(status => ({ key : status, label : statusLabel(status), align : "right" as const })),
                        ],
                        rows : [...runs].reverse().map(run => ({ run : runLabel(run.createdAt), ...run.counts })),
                    }}
                />
            </section>

            <section className={styles.block} aria-labelledby="runs-heading">
                <h2 id="runs-heading">Runs</h2>
                <ScrollTable label="Runs">
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col">Run</th>
                                <th scope="col">Date</th>
                                <th scope="col">Commit</th>
                                <th scope="col">Branch</th>
                                <th scope="col" data-align="right">Passed</th>
                                <th scope="col" data-align="right">Failed</th>
                                <th scope="col" data-align="right">Skipped</th>
                                <th scope="col" data-align="right">To do</th>
                            </tr>
                        </thead>
                        <tbody>
                            {runs.map(run => (
                                <tr key={run.id}>
                                    <th scope="row">
                                        <Link to={encodeURIComponent(run.id)}>{run.id}</Link>
                                    </th>
                                    <td>{formatDateTime(run.createdAt)}</td>
                                    <td>{run.git ? <code>{shortCommit(run.git.commit)}</code> : "–"}</td>
                                    <td>{run.git ? <code>{run.git.branch}</code> : "–"}</td>
                                    <td data-align="right">{run.counts.passed}</td>
                                    <td data-align="right">
                                        {run.counts.failed > 0
                                            ? <StatusIcon kind="failed" showLabel={false} />
                                            : null} {run.counts.failed}
                                    </td>
                                    <td data-align="right">{run.counts.skipped}</td>
                                    <td data-align="right">{run.counts.todo}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </ScrollTable>
            </section>
        </>
    );
}

/** The list of runs, with a chart of the test counts over time. */
export function RunListPage() {
    const source = useReportSource();
    const state = useAsync(() => source.listRuns(), [source]);
    return (
        <div className={styles.page}>
            <title>{`Test results – ${SITE_NAME}`}</title>
            <header className={styles.header}>
                <h1>Test results</h1>
                <p className={styles.intro}>
                    Each run collects the results of the test program: the tests in each environment, coverage, mutation
                    testing, measurements and budgets. Select a run to see its details.
                </p>
            </header>
            {state.status === "loading" ? <Loading text="Loading the list of runs." /> : null}
            {state.status === "error" ? <ErrorState title="The list of runs did not load" error={state.error} /> : null}
            {state.status === "ready" && state.value.runs.length === 0 ? <NoResults /> : null}
            {state.status === "ready" && state.value.runs.length > 0 ? <RunList index={state.value} /> : null}
        </div>
    );
}
