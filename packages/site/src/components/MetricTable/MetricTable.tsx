import { ScrollTable } from "../ScrollTable/ScrollTable";
import type { MetricKind, MetricRow } from "./types";
import styles from "./MetricTable.module.css";

const KIND_LABELS : Readonly<Record<MetricKind, string>> = {
    histogram : "Histogram",
    counter : "Counter",
    gauge : "Gauge",
};

export type MetricTableProps = {
    metrics : readonly MetricRow[];
    caption? : string;
};

/** The metrics of a monitor: name, kind, unit, attributes and description. */
export function MetricTable({ metrics, caption } : MetricTableProps) {
    return (
        <ScrollTable label={caption ?? "Metrics"}>
            <table className={styles.table}>
                {caption ? <caption>{caption}</caption> : null}
                <thead>
                    <tr>
                        <th scope="col">Metric</th>
                        <th scope="col">Kind</th>
                        <th scope="col">Unit</th>
                        <th scope="col">Attributes</th>
                        <th scope="col">Description</th>
                    </tr>
                </thead>
                <tbody>
                    {metrics.map(metric => (
                        <tr key={metric.name}>
                            <th scope="row"><code>{metric.name}</code></th>
                            <td>{KIND_LABELS[metric.kind]}</td>
                            <td><code>{metric.unit}</code></td>
                            <td>
                                {metric.attributes && metric.attributes.length > 0
                                    ? metric.attributes.map((attribute, index) => (
                                        <span key={attribute}>{index > 0 ? ", " : ""}<code>{attribute}</code></span>
                                    ))
                                    : "None"}
                            </td>
                            <td className={styles.description}>{metric.description}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </ScrollTable>
    );
}
