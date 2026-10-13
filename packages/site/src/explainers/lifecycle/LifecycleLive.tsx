import { useEffect, useId, useMemo, useRef, useState } from "react";
import { sharedLifecycle } from "../../adapters/page-lifecycle";
import { isPrerendering } from "../../app/prerender-handoff";
import { DataTable } from "../../components/DataTable/DataTable";
import { formatMs } from "../../lib/format";
import { useElementWidth } from "../../lib/use-element-width";
import { usePrefersReducedMotion } from "../../lib/use-media-query";
import { useThemeColors, type ThemeColors } from "../../theme/colors";
import { Explainer, explainerStyles } from "../Explainer";
import { LIFECYCLE_STATES, segmentsOf, timeInStates, type LifecycleStateName, type ObservedTransition } from "./lifecycle-model";
import styles from "./LifecycleLive.module.css";

/** The time window of the strip. */
const WINDOW_MS = 60_000;
/** The newest transitions in the table. */
const LOG_LIMIT = 8;
const STRIP_HEIGHT = 56;

type Observation = {
    initial : LifecycleStateName;
    /** The `performance.now()` time at which the view started. */
    from : number;
    transitions : readonly ObservedTransition[];
};

type Reads = { visibilityState : string; hasFocus : boolean };

function readDocument() : Reads {
    return { visibilityState : document.visibilityState, hasFocus : document.hasFocus() };
}

function fillOf(state : LifecycleStateName, colors : ThemeColors, hatch : string) : { fill : string; stroke : string } {
    switch (state) {
        case "active": return { fill : colors.accent, stroke : colors.accent };
        case "passive": return { fill : colors.accentWash, stroke : colors.accent };
        case "hidden": return { fill : colors.ruleStrong, stroke : colors.inkMuted };
        case "frozen": return { fill : `url(#${hatch})`, stroke : colors.inkMuted };
        case "terminated": return { fill : colors.mark, stroke : colors.mark };
    }
}

/**
 * The tracker reports the transitions of the whole page. This hook keeps
 * the transitions from the mount of the component, and the current time.
 * In the prerender of the build, it reads nothing.
 */
function useObservation(tick : boolean) : { observation : Observation | undefined; now : number; reads : Reads | undefined } {
    const [observation, setObservation] = useState<Observation>();
    const [now, setNow] = useState(0);
    const [reads, setReads] = useState<Reads>();

    useEffect(() => {
        if (isPrerendering()) return;
        const tracker = sharedLifecycle();
        const initial = tracker.getState();
        const from = performance.now();
        setObservation({ initial, from, transitions : [] });
        setNow(from);
        setReads(readDocument());
        return tracker.subscribe((transition) => {
            setObservation(previous => previous && {
                ...previous,
                transitions : [...previous.transitions, transition],
            });
            setNow(performance.now());
            setReads(readDocument());
        });
    }, []);

    useEffect(() => {
        if (!tick || !observation) return;
        const timer = window.setInterval(() => {
            setNow(performance.now());
            setReads(readDocument());
        }, 1_000);
        return () => window.clearInterval(timer);
    }, [tick, observation]);

    return { observation, now, reads };
}

function Strip({ observation, now, width } : { observation : Observation; now : number; width : number }) {
    const colors = useThemeColors();
    const hatch = useId();
    const since = Math.max(observation.from, now - WINDOW_MS);
    const segments = segmentsOf(observation.initial, observation.from, observation.transitions, since, now);
    const span = Math.max(1, now - since);
    const x = (time : number) : number => ((time - since) / span) * width;
    return (
        <svg viewBox={`0 0 ${width} ${STRIP_HEIGHT}`} width={width} height={STRIP_HEIGHT} aria-hidden="true" focusable="false">
            <defs>
                <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill={colors.surface} />
                    <line x1="0" y1="0" x2="0" y2="6" stroke={colors.inkMuted} strokeWidth="2" />
                </pattern>
            </defs>
            {segments.map((segment, index) => {
                const { fill, stroke } = fillOf(segment.state, colors, hatch);
                return (
                    <rect
                        key={index}
                        x={x(segment.start)} y={8} width={Math.max(1, x(segment.end) - x(segment.start))} height={24}
                        fill={fill} stroke={stroke} strokeWidth={1}
                    />
                );
            })}
            <text x={0} y={STRIP_HEIGHT - 4} fontSize="11" fill={colors.inkMuted}>−{formatMs(span)}</text>
            <text x={width} y={STRIP_HEIGHT - 4} fontSize="11" fill={colors.inkMuted} textAnchor="end">0 s</text>
        </svg>
    );
}

function Legend() {
    const colors = useThemeColors();
    const hatch = useId();
    return (
        <ul className={styles.legend} aria-label="The colors of the states">
            {LIFECYCLE_STATES.map(({ state }) => {
                const { fill, stroke } = fillOf(state, colors, hatch);
                return (
                    <li key={state}>
                        <svg width="16" height="12" aria-hidden="true" focusable="false">
                            <defs>
                                <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                                    <rect width="6" height="6" fill={colors.surface} />
                                    <line x1="0" y1="0" x2="0" y2="6" stroke={colors.inkMuted} strokeWidth="2" />
                                </pattern>
                            </defs>
                            <rect x="0.5" y="0.5" width="15" height="11" fill={fill} stroke={stroke} />
                        </svg>
                        {state}
                    </li>
                );
            })}
        </ul>
    );
}

/**
 * The lifecycle state of this tab, live. The view shows the five states of the
 * tracker and the current state. It also shows the periods of each state in
 * the last minute, and the newest transitions.
 */
export default function LifecycleLive() {
    const reducedMotion = usePrefersReducedMotion();
    const { observation, now, reads } = useObservation(!reducedMotion);
    const stripRef = useRef<HTMLDivElement>(null);
    const width = useElementWidth(stripRef) || 600;

    const current = observation ? (observation.transitions.at(-1)?.to ?? observation.initial) : undefined;
    const last = observation?.transitions.at(-1);
    const totals = useMemo(() => observation
        ? timeInStates(segmentsOf(observation.initial, observation.from, observation.transitions, Math.max(observation.from, now - WINDOW_MS), now))
        : undefined, [observation, now]);
    const seconds = (time : number) : string => observation ? `${((time - observation.from) / 1000).toFixed(1)} s` : "–";

    return (
        <Explainer
            title="The lifecycle state of this tab, live"
            badge="Live"
            caption={
                <>
                    The explainer subscribes to the tracker that the page shares (<code>getPageLifecycle()</code> of
                    {" "}<code>page-lifecycle-tracker</code>), the same tracker that the monitors use. The times are from the load of
                    this explainer. Only Chromium gives the <code>frozen</code> state without a restore from the back/forward cache.
                </>
            }
        >
            <div className={styles.root}>
                <p className={styles.instructions}>
                    Select another window, or another tab, and then come back. Each change of the focus or the visibility is a transition.
                </p>
                <ol className={styles.states} aria-label="The states of the tracker">
                    {LIFECYCLE_STATES.map(({ state, meaning }) => (
                        <li key={state} className={styles.state} data-current={state === current ? "true" : undefined} aria-current={state === current ? "step" : undefined}>
                            <span className={styles.stateName}>{state}</span>
                            <span className={styles.stateMeaning}>{meaning}</span>
                            {state === current ? <span className={styles.here}>This tab</span> : null}
                            {totals && totals[state] > 0 ? <span className={styles.stateTime}>{formatMs(totals[state])} in the last minute</span> : null}
                        </li>
                    ))}
                </ol>

                {observation ? (
                    <>
                        <p className={styles.last}>
                            {last ? (
                                <>Last transition: <code>{last.from}</code> → <code>{last.to}</code> by <code>{last.trigger}</code>, at {seconds(last.timestamp)}.</>
                            ) : (
                                <>No transitions yet. The state at the start was <code>{observation.initial}</code>.</>
                            )}
                        </p>
                        <div ref={stripRef} className={explainerStyles.drawing} role="img" aria-label={
                            `The states of this tab in the last ${Math.round(Math.min(WINDOW_MS, now - observation.from) / 1000)} s: `
                            + LIFECYCLE_STATES.filter(({ state }) => (totals?.[state] ?? 0) > 0).map(({ state }) => `${state} ${formatMs(totals?.[state] ?? 0)}`).join(", ")
                        }>
                            <Strip observation={observation} now={now} width={width} />
                        </div>
                        <Legend />
                        <dl className={explainerStyles.stats}>
                            <div><dt><code>document.visibilityState</code></dt><dd>{reads?.visibilityState ?? "–"}</dd></div>
                            <div><dt><code>document.hasFocus()</code></dt><dd>{reads ? String(reads.hasFocus) : "–"}</dd></div>
                            <div data-tone="accent"><dt><code>getState()</code></dt><dd>{current}</dd></div>
                        </dl>
                        <div className={explainerStyles.tableBlock}>
                            <DataTable
                                label="The newest transitions"
                                spec={{
                                    caption : "The newest transitions, newest first",
                                    columns : [
                                        { key : "time", label : "Time", align : "right" },
                                        { key : "from", label : "From" },
                                        { key : "to", label : "To" },
                                        { key : "trigger", label : "Trigger" },
                                    ],
                                    rows : observation.transitions.length === 0
                                        ? [{ time : "–", from : "–", to : "–", trigger : "No transitions yet" }]
                                        : observation.transitions.slice(-LOG_LIMIT).reverse().map(transition => ({
                                            time : seconds(transition.timestamp),
                                            from : transition.from,
                                            to : transition.to,
                                            trigger : transition.trigger,
                                        })),
                                }}
                            />
                        </div>
                    </>
                ) : (
                    <p className={styles.last}>The live state shows when the page operates in your browser.</p>
                )}
            </div>
        </Explainer>
    );
}
