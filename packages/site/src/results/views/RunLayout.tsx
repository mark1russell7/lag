import { Link, NavLink, Outlet, useLocation, useParams } from "react-router";
import type { RunReport } from "../../adapters/lag-report";
import { SITE_NAME } from "../../app/site";
import { cx } from "../../lib/cx";
import { formatDateTime, shortCommit } from "../../lib/format";
import { useAsync } from "../../lib/use-async";
import { ErrorState, Loading } from "../components/States";
import { budgetCounts } from "../model/budgets";
import { runCounts } from "../model/tests";
import { useReportSource } from "../ReportSourceContext";
import { RUN_PAGES, runPageOf, runPageTitle, type RunPage } from "../run-pages";
import type { RunContext } from "./run-context";
import styles from "./Results.module.css";

type RunView = RunPage & {
    /** A short count after the label, for example "2 failed". */
    badge? : (run : RunReport) => string | undefined;
};

/** The short count after the label of a view, for example "2 failed". */
const BADGES : Readonly<Record<string, (run : RunReport) => string | undefined>> = {
    tests : (run) => {
        const failed = runCounts(run).failed;
        return failed > 0 ? `${failed} failed` : undefined;
    },
    budgets : (run) => {
        const { fail } = budgetCounts(run);
        return fail > 0 ? `${fail} failed` : undefined;
    },
};

/** The views of a run (refer to `run-pages.ts`), with their badges. */
export const RUN_VIEWS : readonly RunView[] = RUN_PAGES.map((page) : RunView => {
    const badge = BADGES[page.path];
    return badge ? { ...page, badge } : page;
});

type LoadResult = { kind : "missing" } | ({ kind : "ready" } & RunContext);

/** This component loads one run, and shows its header, the view navigation and the selected view. */
export function RunLayout() {
    const { runId = "" } = useParams();
    const { pathname } = useLocation();
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
            <title>{runPageTitle(run.id, runPageOf(pathname))}</title>
            <p className={styles.back}><Link to="/results">All runs</Link></p>
            <header className={styles.header}>
                <h1 className={styles.runTitle}>Test run <code>{run.id}</code></h1>
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
