import type { ReactNode } from "react";
import { StatusIcon, type StatusKind } from "../../components/StatusIcon/StatusIcon";
import styles from "./StatTiles.module.css";

export type Stat = {
    label : string;
    value : string;
    /** When set, the tile shows the status icon and its label instead of `label`. */
    kind? : StatusKind;
    detail? : ReactNode;
};

/** A row of headline numbers. */
export function StatTiles({ stats, label } : { stats : readonly Stat[]; label : string }) {
    return (
        <dl className={styles.tiles} aria-label={label}>
            {stats.map(stat => (
                <div key={stat.label} className={styles.tile} data-kind={stat.kind}>
                    <dt className={styles.label}>{stat.kind ? <StatusIcon kind={stat.kind} /> : stat.label}</dt>
                    <dd className={styles.value}>{stat.value}</dd>
                    {stat.detail ? <dd className={styles.detail}>{stat.detail}</dd> : null}
                </div>
            ))}
        </dl>
    );
}
