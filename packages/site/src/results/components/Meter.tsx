import { formatPercent } from "../../lib/format";
import styles from "./Meter.module.css";

/** A percentage as text, with a bar. The text carries the value; the bar is only a visual aid. */
export function Meter({ value } : { value : number | undefined }) {
    if (value === undefined) return <span className={styles.none}>No data</span>;
    const width = Math.max(0, Math.min(100, value));
    return (
        <span className={styles.meter}>
            <span className={styles.value}>{formatPercent(value)}</span>
            <span className={styles.track} aria-hidden="true">
                <span className={styles.fill} style={{ width : `${width}%` }} />
            </span>
        </span>
    );
}
