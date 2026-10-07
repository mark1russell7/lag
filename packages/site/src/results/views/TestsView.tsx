import { useId } from "react";
import { useSearchParams } from "react-router";
import type { StatusCounts } from "../../adapters/lag-report";
import { ScrollTable } from "../../components/ScrollTable/ScrollTable";
import { StatusIcon } from "../../components/StatusIcon/StatusIcon";
import { formatCount, formatMs } from "../../lib/format";
import { compareEnvironments } from "../model/matrix";
import { filterSuites, parseStatusFilter, STATUS_ORDER, totalTests, type SuiteGroup, type TestFilter } from "../model/tests";
import { useRunContext } from "./run-context";
import styles from "./Results.module.css";

const STATUS_LABELS = { failed : "Failed", passed : "Passed", skipped : "Skipped", todo : "To do" } as const;

function countsText(counts : StatusCounts) : string {
    return STATUS_ORDER
        .filter(status => counts[status] > 0)
        .map(status => `${counts[status]} ${STATUS_LABELS[status].toLowerCase()}`)
        .join(", ");
}

function SuiteSection({ group, expandAll } : { group : SuiteGroup; expandAll : boolean }) {
    const headingId = useId();
    const { suite } = group;
    return (
        <section className={styles.suite} aria-labelledby={headingId}>
            <h2 id={headingId} className={styles.suiteTitle}>
                <code>{suite.packageName}</code>: {suite.kind} tests in {suite.environment}
            </h2>
            <p className={styles.suiteMeta}>
                Suite <code>{suite.id}</code>. {countsText(group.counts)}. Duration {formatMs(suite.durationMs)}.
            </p>
            {group.files.map(file => (
                <details key={file.file} className={styles.file} open={expandAll || file.counts.failed > 0}>
                    <summary>
                        <code>{file.file}</code>
                        <span className={styles.fileCounts}>{countsText(file.counts)}</span>
                    </summary>
                    <ScrollTable label={`Tests in ${file.file}`}>
                        <table className={styles.table}>
                            <thead>
                                <tr>
                                    <th scope="col">Status</th>
                                    <th scope="col">Test</th>
                                    <th scope="col" data-align="right">Duration</th>
                                </tr>
                            </thead>
                            <tbody>
                                {file.tests.map(row => (
                                    <tr key={row.key} data-status={row.status}>
                                        <td><StatusIcon kind={row.status} /></td>
                                        <th scope="row">
                                            {row.fullName}
                                            {row.failureMessages.length > 0 ? (
                                                <pre className={styles.message}>{row.failureMessages.join("\n\n")}</pre>
                                            ) : null}
                                        </th>
                                        <td data-align="right">{row.status === "passed" || row.status === "failed" ? formatMs(row.durationMs) : "–"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </ScrollTable>
                </details>
            ))}
        </section>
    );
}

/** The tests of a run, by suite and file, with a filter. The filter is in the URL, so a link can share it. */
export function TestsView() {
    const { run } = useRunContext();
    const [params, setParams] = useSearchParams();
    const queryId = useId();
    const statusId = useId();
    const envId = useId();
    const suiteId = useId();

    const environment = params.get("env") ?? "";
    const suite = params.get("suite") ?? "";
    const filter : TestFilter = {
        query : params.get("q") ?? "",
        status : parseStatusFilter(params.get("status")),
        environment : environment || undefined,
    };
    const groups = filterSuites(run, filter, suite || undefined);
    const shown = groups.reduce((sum, group) => sum + totalTests(group.counts), 0);
    const total = run.suites.reduce((sum, item) => sum + item.files.reduce((count, file) => count + file.tests.length, 0), 0);
    const environments = [...new Set(run.suites.map(item => item.environment))].sort(compareEnvironments);
    const filtered = filter.query !== "" || filter.status !== "all" || environment !== "" || suite !== "";

    const update = (key : string, value : string) : void => {
        setParams((previous) => {
            const next = new URLSearchParams(previous);
            if (value) next.set(key, value);
            else next.delete(key);
            return next;
        }, { replace : true });
    };

    return (
        <>
            <form className={styles.filters} role="search" aria-label="Filter the tests" onSubmit={(event) => event.preventDefault()}>
                <div className={styles.field}>
                    <label htmlFor={queryId}>Name contains</label>
                    <input
                        id={queryId}
                        className="control"
                        type="search"
                        value={filter.query}
                        placeholder="For example: heartbeat"
                        onChange={(event) => update("q", event.target.value)}
                    />
                </div>
                <div className={styles.field}>
                    <label htmlFor={statusId}>Status</label>
                    <select id={statusId} className="control" value={filter.status} onChange={(event) => update("status", event.target.value === "all" ? "" : event.target.value)}>
                        <option value="all">All</option>
                        {STATUS_ORDER.map(status => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
                    </select>
                </div>
                <div className={styles.field}>
                    <label htmlFor={envId}>Environment</label>
                    <select id={envId} className="control" value={environment} onChange={(event) => update("env", event.target.value)}>
                        <option value="">All</option>
                        {environments.map(name => <option key={name} value={name}>{name}</option>)}
                    </select>
                </div>
                <div className={styles.field}>
                    <label htmlFor={suiteId}>Suite</label>
                    <select id={suiteId} className="control" value={suite} onChange={(event) => update("suite", event.target.value)}>
                        <option value="">All</option>
                        {run.suites.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}
                    </select>
                </div>
            </form>
            <p className={styles.resultCount} role="status">
                {filtered ? `${formatCount(shown, "test")} of ${total} match the filter.` : `${formatCount(total, "test")} in ${formatCount(run.suites.length, "suite")}.`}
            </p>
            {groups.length === 0 ? <p className={styles.muted}>No test matches the filter.</p> : null}
            {groups.map(group => <SuiteSection key={group.suite.id} group={group} expandAll={filtered} />)}
        </>
    );
}
