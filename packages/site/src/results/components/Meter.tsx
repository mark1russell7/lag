import { formatPercent } from "../../lib/format";
import styles from "./Meter.module.css";

/**
 * A percentage as text, with a bar. The text gives the value. The bar is only
 * a visual aid. Without a value, the meter shows `emptyText`.
 */
export function Meter({ value, emptyText = "No data" } : { value : number | undefined; emptyText? : string }) {
    if (value === undefined) return <span className={styles.none}>{emptyText}</span>;
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
