import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { METRIC_DEFINITIONS, demoSupported, type DemoFocus } from "../../adapters/lag-core";
import { formatBytes, formatNumber, formatPercent, formatValue } from "../../lib/format";
import { usePrefersReducedMotion } from "../../lib/use-media-query";
import { loadLabel } from "../../playground/catalog";
import { DEMOS, type DemoInfo, type DemoLoad, type DemoValue } from "../../playground/demos";
import { LivePlot } from "../../playground/LiveChart";
import type { LiveSeries, PlaygroundSession, PlaygroundSnapshot, WatchedInstrument } from "../../playground/session";
import { useSession } from "../../playground/use-session";
import { supportSummary } from "./support";
import styles from "./LiveDemo.module.css";

export type LiveDemoProps = {
    /** The monitor of the demo: the path of its page below `/docs/monitors/`. */
    monitor : DemoFocus;
};

/** The part of the demo that must be visible before it starts. */
const VISIBLE_RATIO = 0.25;

/** The time from the click to the layout shift. A shift less than 500 ms after an input has recent input, and it does not count. */
const SHIFT_DELAY_MS = 1_000;

const EMPTY_SERIES : LiveSeries = { points : [], count : 0, latest : undefined, p95 : undefined, max : undefined };

const EMPTY_WATCHED : WatchedInstrument = { series : EMPTY_SERIES, count : 0, total : 0, totalsByAttribute : {}, recent : [] };

/**
 * This hook starts `onVisible` one time, when the element comes into view.
 * Without `IntersectionObserver`, it starts it at once.
 */
function useFirstVisible(element : HTMLElement | null, enabled : boolean, onVisible : () => void) : void {
    const callback = useRef(onVisible);
    callback.current = onVisible;
    useEffect(() => {
        if (!enabled || !element) return;
        if (typeof IntersectionObserver === "undefined") {
            callback.current();
            return;
        }
        const observer = new IntersectionObserver((entries) => {
            if (entries.some(entry => entry.isIntersecting)) {
                observer.disconnect();
                callback.current();
            }
        }, { threshold : VISIBLE_RATIO });
        observer.observe(element);
        return () => observer.disconnect();
    }, [element, enabled]);
}

function watchedOf(snapshot : PlaygroundSnapshot | undefined, name : string) : WatchedInstrument {
    return snapshot?.watched[name] ?? EMPTY_WATCHED;
}

/** The text of one value of the demo. */
function valueText(value : DemoValue, watched : WatchedInstrument) : string {
    const definition = METRIC_DEFINITIONS[value.metric];
    const format = (number : number) : string => {
        if (value.format === "percent") return formatPercent(number * 100);
        if (definition.unit === "By") return formatBytes(number);
        return formatValue(number, definition.unit);
    };
    switch (value.show) {
        case "count": return formatNumber(watched.count, 0);
        case "total": {
            const total = value.attribute ? watched.totalsByAttribute[value.attribute] ?? 0 : watched.total;
            return definition.kind === "counter" ? formatNumber(total, 0) : format(total);
        }
        case "latest": {
            const latest = watched.recent[0]?.value;
            return latest === undefined ? "–" : format(latest);
        }
        case "max": return watched.series.max === undefined ? "–" : format(watched.series.max);
    }
}

/**
 * The values of a counter in the time window as its running total, so that
 * a chart shows each step. The line continues to the current time.
 */
function runningTotal(watched : WatchedInstrument, elapsedSeconds : number) : LiveSeries {
    const { points } = watched.series;
    let total = watched.total - points.reduce((sum, point) => sum + point.value, 0);
    const running = points.map((point) => {
        total += point.value;
        return { t : point.t, value : total };
    });
    if (running.length > 0) running.push({ t : elapsedSeconds, value : total });
    return { ...watched.series, points : running, latest : total, max : total };
}

function loadText(load : DemoLoad) : string {
    switch (load.kind) {
        case "action": return loadLabel("action", load.id);
        case "profile": return load.label;
        case "shift": return "Shift the layout in 1 s";
    }
}

function statusText(snapshot : PlaygroundSnapshot | undefined, reducedMotion : boolean) : string {
    if (!snapshot || snapshot.status === "idle") {
        return reducedMotion ? "Select “Start the demo” to start the monitor." : "The demo starts when it comes into view.";
    }
    if (snapshot.status === "failed") return `The monitor did not start: ${snapshot.error ?? "unknown error"}.`;
    if (snapshot.status === "stopped") return "The monitor is stopped.";
    const seconds = Math.floor(snapshot.elapsedSeconds);
    return snapshot.activeLoad ? `The load operates (${seconds} s).` : `The monitor operates in this tab (${seconds} s).`;
}

function Loads({ demo, session, snapshot, onShift } : { demo : DemoInfo; session : PlaygroundSession | undefined; snapshot : PlaygroundSnapshot | undefined; onShift : () => void }) {
    if (demo.loads.length === 0) return null;
    const ready = snapshot?.status === "running" && session?.canRunLoad === true;
    return (
        <div className={styles.loads} role="group" aria-label="Load">
            {demo.loads.map((load) => {
                const run = () : void => {
                    if (!session) return;
                    if (load.kind === "action") void session.runLoad(load.id);
                    else if (load.kind === "profile") void session.runProfile(load.id, load.durationMs);
                    else onShift();
                };
                return (
                    <button key={loadText(load)} type="button" className="button" disabled={load.kind === "shift" ? snapshot?.status !== "running" : !ready} onClick={run}>
                        {loadText(load)}
                    </button>
                );
            })}
        </div>
    );
}

function Transitions({ snapshot, watched } : { snapshot : PlaygroundSnapshot | undefined; watched : WatchedInstrument }) {
    const rows = watched.recent;
    return (
        <div className={styles.transitions}>
            <p className={styles.state}>
                <span className={styles.stateLabel}>State of this tab</span>
                <span className={styles.stateValue}>{snapshot?.lifecycleState ?? "–"}</span>
            </p>
            <table className={styles.table}>
                <caption>The newest transitions</caption>
                <thead>
                    <tr>
                        <th scope="col" data-align="right">Time (s)</th>
                        <th scope="col">From</th>
                        <th scope="col">To</th>
                        <th scope="col">Trigger</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.length === 0 ? (
                        <tr><td colSpan={4}>No transitions yet.</td></tr>
                    ) : rows.map((row, index) => (
                        <tr key={`${row.t}-${index}`}>
                            <td data-align="right">{row.t.toFixed(1)}</td>
                            <td>{String(row.attributes?.["from"] ?? "")}</td>
                            <td>{String(row.attributes?.["to"] ?? "")}</td>
                            <td>{String(row.attributes?.["trigger"] ?? "")}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Unsupported({ demo } : { demo : DemoInfo }) {
    const summary = demo.feature ? supportSummary(demo.feature) : undefined;
    return (
        <p className={styles.unsupported}>
            This browser does not have the API of <code>{demo.monitor}</code>
            {demo.feature ? <> ({demo.feature})</> : null}, thus the demo cannot start here. {summary}{" "}
            Refer to <Link to="/research/browser-support">browser support</Link>.
        </p>
    );
}

/**
 * A live demo of one monitor in its page of the documentation. It starts the
 * monitor in this tab when the demo comes into view. With "reduce motion",
 * it waits until the reader starts it. The buttons make the load that gives
 * the signal of the monitor.
 */
export default function LiveDemo({ monitor } : LiveDemoProps) {
    const demo = DEMOS[monitor];
    const titleId = useId();
    const reducedMotion = usePrefersReducedMotion();
    const [supported] = useState(() => demoSupported(monitor));
    const { session, snapshot, error } = useSession(`demo:${monitor}`);
    const [element, setElement] = useState<HTMLElement | null>(null);
    const [shifted, setShifted] = useState(false);
    const shiftTimer = useRef<number | undefined>(undefined);

    useFirstVisible(element, supported && !reducedMotion && session !== undefined, () => session?.start());
    useEffect(() => () => window.clearTimeout(shiftTimer.current), []);

    const running = snapshot?.status === "running";
    const chart = demo.chart;
    const chartWatched = chart ? watchedOf(snapshot, METRIC_DEFINITIONS[chart.metric].name) : EMPTY_WATCHED;
    const series = chart?.mark === "count" ? runningTotal(chartWatched, snapshot?.elapsedSeconds ?? 0) : chartWatched.series;
    const shift = () : void => {
        window.clearTimeout(shiftTimer.current);
        shiftTimer.current = window.setTimeout(() => setShifted(value => !value), SHIFT_DELAY_MS);
    };

    return (
        <section ref={setElement} className={styles.demo} aria-labelledby={titleId}>
            <header className={`${styles.header} graph-paper`}>
                <p id={titleId} className={styles.title}>
                    <span className={styles.badge}>Live demo</span> <code>{demo.monitor}</code> in this tab
                </p>
                <p className={styles.status}>
                    <span className={styles.dot} data-running={running ? "true" : undefined} aria-hidden="true" />
                    {supported ? statusText(snapshot, reducedMotion) : "This browser cannot start the demo."}
                </p>
            </header>
            <div className={styles.body}>
                {!supported ? <Unsupported demo={demo} /> : (
                    <>
                        <p className={styles.instructions}>{demo.instructions}</p>
                        {error ? <p className={styles.unsupported}>The monitor did not load: {error.message}</p> : null}
                        <div className={styles.controls}>
                            <Loads demo={demo} session={session} snapshot={snapshot} onShift={shift} />
                            {running ? (
                                <button type="button" className="button" onClick={() => session?.stop()}>Stop the demo</button>
                            ) : (
                                <button type="button" className="button" data-variant="primary" disabled={!session} onClick={() => session?.start()}>
                                    {snapshot?.status === "stopped" ? "Start again" : "Start the demo"}
                                </button>
                            )}
                        </div>
                        {shifted ? <div className={styles.shiftBox} aria-hidden="true">A box that moves the content below it.</div> : null}
                        {chart ? (
                            <LivePlot
                                title={chart.title}
                                description={chart.description}
                                series={series}
                                windowSeconds={snapshot?.windowSeconds ?? 30}
                                elapsedSeconds={snapshot?.elapsedSeconds ?? 0}
                                mark={chart.mark === "count" ? "total" : chart.mark}
                                unit={chart.mark === "count" ? "{gc}" : METRIC_DEFINITIONS[chart.metric].unit}
                                height={150}
                                {...(chart.reference ? { reference : chart.reference } : {})}
                            />
                        ) : (
                            <Transitions snapshot={snapshot} watched={watchedOf(snapshot, METRIC_DEFINITIONS.lifecycleTransitions.name)} />
                        )}
                        {chart && series.count === 0 ? <p className={styles.empty}>{chart.emptyText}</p> : null}
                        <dl className={styles.values}>
                            {demo.values.map(value => (
                                <div key={value.label}>
                                    <dt>{value.label}</dt>
                                    <dd>{valueText(value, watchedOf(snapshot, METRIC_DEFINITIONS[value.metric].name))}</dd>
                                </div>
                            ))}
                        </dl>
                    </>
                )}
            </div>
            <footer className={styles.footer}>
                The demo gives <code>setupAllMonitors()</code> only the browser APIs of this monitor. The timer monitors of each
                setup also operate. <Link to="/playground">Open the playground</Link> to see all the monitors together.
            </footer>
        </section>
    );
}
