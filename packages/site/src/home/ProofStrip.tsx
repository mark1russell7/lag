import { Link } from "react-router";
import { StatusIcon } from "../components/StatusIcon/StatusIcon";
import { formatCount, formatDate, formatNumber, formatPercent, shortCommit } from "../lib/format";
import { useAsync } from "../lib/use-async";
import { sortRunsNewestFirst } from "../results/model/trend";
import { useReportSource } from "../results/ReportSourceContext";
import { LIBRARY_PACKAGE, proofNumbers } from "./proof";
import styles from "./Home.module.css";

const NPM_URL = `https://www.npmjs.com/package/${LIBRARY_PACKAGE}`;

/**
 * The numbers of the newest run of the test program: the tests, the
 * browsers, the mutation score and the coverage. The results section has
 * the details. Without results, the strip shows only the package.
 */
export function ProofStrip() {
    const source = useReportSource();
    const state = useAsync(async () => {
        const latest = sortRunsNewestFirst((await source.listRuns()).runs)[0];
        if (!latest) return undefined;
        const run = await source.getRun(latest.file).catch(() => undefined);
        return proofNumbers(latest, run);
    }, [source]);

    if (state.status === "loading") {
        return <div className={styles.proof} aria-busy="true"><p className={styles.proofLoading}>The test results load.</p></div>;
    }
    const numbers = state.status === "ready" ? state.value : undefined;
    const runPath = numbers ? `/results/${encodeURIComponent(numbers.runId)}` : "/results";

    return (
        <section className={styles.proof} aria-labelledby="proof-title">
            <h2 id="proof-title" className="visually-hidden">The evidence</h2>
            <dl className={styles.proofList}>
                {numbers ? (
                    <div className={styles.proofItem}>
                        <dt>Tests in the newest run</dt>
                        <dd className={styles.proofValue}>{formatNumber(numbers.passed, 0)}</dd>
                        <dd className={styles.proofText}>
                            {numbers.failed > 0
                                ? <StatusIcon kind="failed" detail={`: ${formatCount(numbers.failed, "test")}`} />
                                : <StatusIcon kind="passed" />}
                            {" "}<Link to={runPath}>{formatDate(numbers.createdAt)}{numbers.commit ? `, ${shortCommit(numbers.commit)}` : ""}</Link>
                        </dd>
                    </div>
                ) : null}
                {numbers && numbers.browsers.length > 0 ? (
                    <div className={styles.proofItem}>
                        <dt>Browser setups</dt>
                        <dd className={styles.proofValue}>{numbers.browsers.length}</dd>
                        <dd className={styles.proofText}>{numbers.browsers.join(", ")}</dd>
                    </div>
                ) : null}
                {numbers?.mutationScore !== undefined ? (
                    <div className={styles.proofItem}>
                        <dt>Mutation score</dt>
                        <dd className={styles.proofValue}>{formatPercent(numbers.mutationScore)}</dd>
                        <dd className={styles.proofText}><Link to={`${runPath}/mutation`}>The tests find the changed code</Link></dd>
                    </div>
                ) : null}
                {numbers?.statements !== undefined ? (
                    <div className={styles.proofItem}>
                        <dt>Coverage</dt>
                        <dd className={styles.proofValue}>{formatPercent(numbers.statements)}</dd>
                        <dd className={styles.proofText}>
                            <Link to={`${runPath}/coverage`}>Of the statements{numbers.branches !== undefined ? `, ${formatPercent(numbers.branches)} of the branches` : ""}</Link>
                        </dd>
                    </div>
                ) : null}
                <div className={styles.proofItem}>
                    <dt>On npm</dt>
                    <dd className={styles.proofValue}><a href={NPM_URL}>{LIBRARY_PACKAGE}</a></dd>
                    <dd className={styles.proofText}>With provenance from the release workflow</dd>
                </div>
            </dl>
        </section>
    );
}
