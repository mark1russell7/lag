import { useEffect, useState } from "react";
import { Link } from "react-router";
import { PlotFigure, type Markish } from "../components/PlotFigure/PlotFigure";
import { formatMs } from "../lib/format";
import { usePrefersReducedMotion } from "../lib/use-media-query";
import { useSession } from "../playground/use-session";
import styles from "./Home.module.css";

/** The long task threshold: work of 50 ms or more blocks the main thread for a noticeable time. */
const LONG_MS = 50;

/**
 * A small live reading of this tab: the timer drift that `DriftLag` measures
 * now. It runs only the timer monitors, so its cost is small. With "reduce
 * motion", it waits until the reader starts it.
 */
export default function MainThreadIndicator() {
    const reducedMotion = usePrefersReducedMotion();
    const [running, setRunning] = useState(() => !reducedMotion);
    const { session, snapshot, error } = useSession("timers");

    useEffect(() => {
        if (!session) return;
        if (running) session.start();
        else session.stop();
    }, [session, running]);

    const drift = snapshot?.series.drift;
    const windowSeconds = snapshot?.windowSeconds ?? 10;
    const end = Math.max(windowSeconds, snapshot?.elapsedSeconds ?? 0);
    const value = drift?.p95;

    return (
        <aside className={`${styles.indicator} graph-paper`} aria-labelledby="now-title">
            <p id="now-title" className={styles.indicatorTitle}>This tab, now</p>
            {error ? <p className={styles.indicatorText}>The monitor did not start: {error.message}</p> : null}
            <p className={styles.reading}>
                <span className={styles.readingValue}>{value === undefined ? "–" : formatMs(value)}</span>
                <span className={styles.readingLabel}>timer drift, p95 of the last {windowSeconds} s</span>
            </p>
            <PlotFigure
                title={`Timer drift in this tab, the last ${windowSeconds} seconds`}
                description={`One line for each 100 ms window of DriftLag. Red lines are windows that ended ${LONG_MS} ms or more late.`}
                hideTitle
                height={96}
                options={({ Plot, theme }) => {
                    const points = drift?.points ?? [];
                    const marks : Markish[] = [
                        Plot.ruleY([0], { stroke : theme.chartAxis }),
                        Plot.ruleX(points.filter(point => point.value < LONG_MS), { x : "t", y1 : 0, y2 : "value", stroke : theme.inkSecondary, strokeWidth : 2 }),
                        Plot.ruleX(points.filter(point => point.value >= LONG_MS), { x : "t", y1 : 0, y2 : "value", stroke : theme.mark, strokeWidth : 3 }),
                    ];
                    return {
                        marginLeft : 36,
                        marginRight : 8,
                        marginBottom : 22,
                        x : { domain : [end - windowSeconds, end], label : null, ticks : 0 },
                        y : { label : null, ticks : 2, nice : true, domain : [0, Math.max(20, drift?.max ?? 0)], tickFormat : (tick : number) => `${tick} ms` },
                        marks,
                    };
                }}
            />
            <p className={styles.indicatorText}>
                <code>DriftLag</code> measures this value in this page now. A red line is a window that ended {LONG_MS} ms
                or more late. <Link to="/playground">Open the playground</Link> to see all the monitors.
            </p>
            <button type="button" className="button" onClick={() => setRunning(value => !value)}>
                {running ? "Stop measuring" : "Measure this tab"}
            </button>
        </aside>
    );
}
