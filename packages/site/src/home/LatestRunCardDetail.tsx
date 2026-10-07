import { Link } from "react-router";
import { StatusIcon } from "../components/StatusIcon/StatusIcon";
import { formatDateTime } from "../lib/format";
import { useAsync } from "../lib/use-async";
import { sortRunsNewestFirst } from "../results/model/trend";
import { useReportSource } from "../results/ReportSourceContext";
import styles from "./Home.module.css";

/** The newest run, for the card of the results section. */
export function LatestRunCardDetail() {
    const source = useReportSource();
    const state = useAsync(() => source.listRuns(), [source]);

    if (state.status === "loading") return <p className={styles.cardMeta} aria-busy="true">Loading the newest run.</p>;
    if (state.status === "error") return <p className={styles.cardMeta}>The list of runs did not load.</p>;

    const latest = sortRunsNewestFirst(state.value.runs)[0];
    if (!latest) {
        return <p className={styles.cardMeta}>There are no results yet. Run <code>pnpm results</code> to make them.</p>;
    }
    const total = latest.counts.passed + latest.counts.failed + latest.counts.skipped + latest.counts.todo;
    return (
        <div className={styles.cardDetail}>
            <p className={styles.cardMeta}>Newest run: {formatDateTime(latest.createdAt)}</p>
            <p className={styles.cardStatus}>
                <StatusIcon
                    kind={latest.counts.failed > 0 ? "failed" : "passed"}
                    detail={latest.counts.failed > 0 ? `: ${latest.counts.failed} of ${total} tests` : `: ${total} tests`}
                />
            </p>
            <p className={styles.cardMeta}><Link to={`/results/${encodeURIComponent(latest.id)}`}>See the newest run</Link></p>
        </div>
    );
}
