import { Link } from "react-router";
import { StatusIcon } from "../components/StatusIcon/StatusIcon";
import { formatDateTime } from "../lib/format";
import { useAsync } from "../lib/use-async";
import { runSummaryDetail, runSummaryStatus } from "../results/model/tests";
import { sortRunsNewestFirst } from "../results/model/trend";
import { useReportSource } from "../results/ReportSourceContext";
import styles from "./Home.module.css";

/** The newest run, for the card of the results section. */
export function LatestRunCardDetail() {
    const source = useReportSource();
    const state = useAsync(() => source.listRuns(), [source]);

    if (state.status === "loading") return <p className={styles.cardMeta} aria-busy="true">The newest run loads.</p>;
    if (state.status === "error") return <p className={styles.cardMeta}>The list of runs did not load.</p>;

    const latest = sortRunsNewestFirst(state.value.runs)[0];
    if (!latest) {
        return <p className={styles.cardMeta}>There are no results at this time. Use <code>pnpm results</code> to make them.</p>;
    }
    return (
        <div className={styles.cardDetail}>
            <p className={styles.cardMeta}>Newest run: {formatDateTime(latest.createdAt)}</p>
            <p className={styles.cardStatus}>
                {/* A failed budget makes the run fail, also when all tests passed */}
                <StatusIcon kind={runSummaryStatus(latest)} detail={runSummaryDetail(latest)} />
            </p>
            <p className={styles.cardMeta}><Link to={`/results/${encodeURIComponent(latest.id)}`}>Open the newest run</Link></p>
        </div>
    );
}
