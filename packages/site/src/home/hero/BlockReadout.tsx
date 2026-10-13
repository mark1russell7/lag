import type { ReactNode } from "react";
import { Link } from "react-router";
import { RatingTag } from "../../components/RatingTag/RatingTag";
import { formatMs } from "../../lib/format";
import { loadLabel } from "../../playground/catalog";
import type { BlockReading, BlockReport, ReadingId } from "./block-readings";
import styles from "./Hero.module.css";

const MONITORS : Readonly<Record<ReadingId, { name : string; measures : string; to : string }>> = {
    drift : { name : "DriftLag", measures : "Blocked time in its windows", to : "/docs/monitors/drift-lag" },
    worker : { name : "Worker lag", measures : "The longest wait of a heartbeat", to : "/docs/monitors/worker-lag" },
    frames : { name : "Frame timing", measures : "The longest time between two frames", to : "/docs/monitors/frame-timing" },
    loaf : { name : "Long animation frame", measures : "The longest frame, from the browser", to : "/docs/monitors/long-animation-frames" },
    event : { name : "Event timing", measures : "Your click, from the input to the next paint", to : "/docs/monitors/event-timing" },
};

const READING_IDS : readonly ReadingId[] = ["drift", "worker", "frames", "loaf", "event"];

function detail(reading : BlockReading) : ReactNode {
    if (reading.state === "unsupported") return reading.id === "worker" ? "No worker in this browser." : "Not in this browser.";
    if (reading.state === "waiting") return "The value comes after the next frames.";
    if (reading.state === "missing") return "No value for this load.";
    switch (reading.id) {
        case "drift": return reading.windows === 1 ? "One window" : `${reading.windows ?? 0} windows`;
        case "worker": return `${reading.heartbeats ?? 0} heartbeats waited`;
        case "frames": return `${reading.dropped ?? 0} frames dropped`;
        case "loaf": return `Blocking ${formatMs(reading.blockingMs ?? 0)}`;
        case "event": return reading.rating ? <RatingTag rating={reading.rating} prefix="INP:" /> : null;
    }
}

export type BlockReadoutProps = {
    /** The last load and the readings of the monitors, or `undefined` before the first load. */
    report : BlockReport | undefined;
    busy : boolean;
};

/**
 * The same block, measured by five monitors: one row for each monitor,
 * with a bar on one scale for all rows. A thin line in each bar marks the
 * duration of the load.
 */
export function BlockReadout({ report, busy } : BlockReadoutProps) {
    const readings = report?.readings ?? READING_IDS.map(id => ({ id, state : "waiting" }) as BlockReading);
    const values = readings.map(reading => (reading.state === "measured" ? reading.valueMs ?? 0 : 0));
    const top = Math.max(1, report?.load.durationMs ?? 0, ...values);

    let caption : string;
    if (busy) caption = "The main thread is busy.";
    else if (!report) caption = "Press a button. Then five monitors measure the same block.";
    else caption = `${loadLabel("action", report.load.id)}: the load took ${formatMs(report.load.durationMs)}. Each monitor measures a different quantity of it.`;

    return (
        <table className={styles.readout}>
            <caption className={styles.readoutCaption}>{caption}</caption>
            <thead className="visually-hidden">
                <tr>
                    <th scope="col">Monitor</th>
                    <th scope="col">Value</th>
                </tr>
            </thead>
            <tbody>
                {readings.map((reading, index) => {
                    const monitor = MONITORS[reading.id];
                    const value = values[index]!;
                    const measured = report !== undefined && reading.state === "measured";
                    return (
                        <tr key={reading.id} data-state={report ? reading.state : "idle"}>
                            <th scope="row" className={styles.readoutMonitor}>
                                <Link to={monitor.to} className={styles.readoutName}>{monitor.name}</Link>
                                <span className={styles.readoutMeasures}>{monitor.measures}</span>
                            </th>
                            <td className={styles.readoutCell}>
                                <span className={styles.readoutBar} aria-hidden="true">
                                    <span className={styles.readoutFill} style={{ width : `${measured ? Math.max(1.5, (value / top) * 100) : 0}%` }} />
                                    {report ? <span className={styles.readoutTruth} style={{ left : `${(report.load.durationMs / top) * 100}%` }} /> : null}
                                </span>
                                <span className={styles.readoutValue}>{measured ? formatMs(value) : "–"}</span>
                                <span className={styles.readoutDetail}>{report ? detail(reading) : ""}</span>
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
}
