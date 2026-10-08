import { Callout } from "../../components/Callout/Callout";
import styles from "./States.module.css";

export function Loading({ text } : { text : string }) {
    return <p className={styles.loading} aria-busy="true">{text}</p>;
}

export function ErrorState({ title, error } : { title : string; error : Error }) {
    return (
        <Callout type="warning" title={title}>
            <p>{error.message}</p>
        </Callout>
    );
}

/** The empty state of the results viewer. It tells the reader how to make results. */
export function NoResults() {
    return (
        <div className={styles.empty}>
            <h2 className={styles.emptyTitle}>There are no test results at this time</h2>
            <p>
                To make the results, use <code>pnpm results</code> in the root of the repository. The command writes the
                files to <code>packages/site/public/data/results/</code>. Then load this page again.
            </p>
            {import.meta.env.DEV ? (
                <p>To see the views with sample data, select <strong>Show sample data</strong> at the top of this page.</p>
            ) : null}
        </div>
    );
}

export function EmptySection({ text } : { text : string }) {
    return <p className={styles.emptySection}>{text}</p>;
}
