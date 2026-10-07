import { Link, NavLink, Outlet, useParams } from "react-router";
import type { RunReport } from "../../adapters/lag-report";
import { SITE_NAME } from "../../app/site";
import { cx } from "../../lib/cx";
import { formatDateTime, shortCommit } from "../../lib/format";
import { useAsync } from "../../lib/use-async";
import { ErrorState, Loading } from "../components/States";
import { budgetCounts } from "../model/budgets";
import { runCounts } from "../model/tests";
import { useReportSource } from "../ReportSourceContext";
import type { RunContext } from "./run-context";
import styles from "./Results.module.css";

type RunView = {
    path : string;
    label : string;
    /** A short count after the label, for example "2 failed". */
    badge? : (run : RunReport) => string | undefined;
};

/** The views of a run. To add a view, add a route in app/sections.tsx and an entry here. */
export const RUN_VIEWS : readonly RunView[] = [
    { path : ".", label : "Overview" },
    { path : "tests", label : "Tests", badge : (run) => {
        const failed = runCounts(run).failed;
        return failed > 0 ? `${failed} failed` : undefined;
    } },
    { path : "coverage", label : "Coverage" },
    { path : "mutation", label : "Mutation" },
    { path : "budgets", label : "Budgets", badge : (run) => {
        const { fail } = budgetCounts(run);
        return fail > 0 ? `${fail} failed` : undefined;
    } },
    { path : "measurements", label : "Measurements" },
];

type LoadResult = { kind : "missing" } | ({ kind : "ready" } & RunContext);

/** Loads one run and shows its header, the view navigation and the selected view. */
export function RunLayout() {
    const { runId = "" } = useParams();
    const source = useReportSource();
    const state = useAsync(async () : Promise<LoadResult> => {
        const index = await source.listRuns();
        const summary = index.runs.find(run => run.id === runId);
        if (!summary) return { kind : "missing" };
        const run = await source.getRun(summary.file);
        return { kind : "ready", index, summary, run };
    }, [source, runId]);

    if (state.status === "loading") {
        return <div className={styles.page}><Loading text="Loading the run." /></div>;
    }
    if (state.status === "error") {
        return <div className={styles.page}><ErrorState title="The run did not load" error={state.error} /></div>;
    }
    if (state.value.kind === "missing") {
        return (
            <div className={styles.page}>
                <title>{`Run not found – ${SITE_NAME}`}</title>
                <h1>There is no run with this ID</h1>
                <p>The list of runs has no run <code>{runId}</code>.</p>
                <p><Link to="/results">Go to the list of runs</Link></p>
            </div>
        );
    }

    const { index, summary, run } = state.value;
    const context : RunContext = { index, summary, run };
    return (
        <div className={styles.page}>
            <title>{`Run ${run.id} – ${SITE_NAME}`}</title>
            <p className={styles.back}><Link to="/results">All runs</Link></p>
            <header className={styles.header}>
                <h1 className={styles.runTitle}>Run <code>{run.id}</code></h1>
                <dl className={styles.runMeta}>
                    <div><dt>Date</dt><dd>{formatDateTime(run.createdAt)}</dd></div>
                    {run.git ? <div><dt>Commit</dt><dd><code>{shortCommit(run.git.commit)}</code></dd></div> : null}
                    {run.git ? <div><dt>Branch</dt><dd><code>{run.git.branch}</code></dd></div> : null}
                </dl>
            </header>
            <nav className={styles.views} aria-label="Views of this run">
                <ul>
                    {RUN_VIEWS.map(view => {
                        const badge = view.badge?.(run);
                        return (
                            <li key={view.path}>
                                <NavLink to={view.path} end className={cx(styles.viewLink)}>
                                    {view.label}
                                    {badge ? <span className={styles.badge}>{badge}</span> : null}
                                </NavLink>
                            </li>
                        );
                    })}
                </ul>
            </nav>
            <Outlet context={context} />
        </div>
    );
}
