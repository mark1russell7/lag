import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import type { LoadActionId } from "../../adapters/lag-load";
import { usePrefersReducedMotion } from "../../lib/use-media-query";
import { LOAD_ACTIONS } from "../../playground/catalog";
import { useSession } from "../../playground/use-session";
import { keepMeasured, snapshotReadings, type BlockReport } from "./block-readings";
import { BlockReadout } from "./BlockReadout";
import { LiveStrip } from "./LiveStrip";
import { MotionLanes } from "./MotionLanes";
import styles from "./Hero.module.css";

/** The load buttons of the home page. A hang of 6 s is only in the playground. */
const HERO_ACTIONS : readonly LoadActionId[] = ["block-200", "block-800", "layout-thrash"];

/** The events that show a reader at the page. The first one starts the monitors. */
const INPUT_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

/**
 * This hook starts `onInput` one time, at the first input of the reader. A
 * page load without input (for example a crawler or a lab test) starts no
 * monitor and no worker.
 */
function useFirstInput(enabled : boolean, onInput : () => void) : void {
    useEffect(() => {
        if (!enabled || typeof window === "undefined") return undefined;
        const options = { capture : true, passive : true } as const;
        const remove = () : void => {
            for (const type of INPUT_EVENTS) window.removeEventListener(type, handle, options);
        };
        const handle = () : void => {
            remove();
            onInput();
        };
        for (const type of INPUT_EVENTS) window.addEventListener(type, handle, options);
        return remove;
    }, [enabled, onInput]);
}

/**
 * The instrument of the home page. It shows main-thread lag in this tab.
 * The main thread moves one dot, and the compositor moves a second dot.
 * Three buttons block the main thread. A live strip has one lane for each
 * monitor. A table gives the values that five monitors measured for the
 * last block.
 */
export function HeroInstrument() {
    const reducedMotion = usePrefersReducedMotion();
    const { session, snapshot, error } = useSession("home");
    // `undefined`: the reader did not select. Then the monitors start at the first input, except with "reduce motion".
    const [measure, setMeasure] = useState<boolean | undefined>(undefined);
    const [motion, setMotion] = useState<boolean | undefined>(undefined);
    const playing = motion ?? !reducedMotion;
    const wanted = measure === true;

    const startOnInput = useCallback(() => setMeasure(previous => previous ?? true), []);
    useFirstInput(measure === undefined && !reducedMotion, startOnInput);

    useEffect(() => {
        if (!session) return;
        if (wanted) session.start();
        else session.stop();
    }, [session, wanted]);

    const status = snapshot?.status ?? "idle";
    const running = status === "running";
    const busy = snapshot?.activeLoad !== undefined;

    const run = (id : LoadActionId) : void => {
        if (!session) return;
        // A button press starts the monitors. The values of the first block can be incomplete: the monitors calibrate first.
        if (!running) {
            setMeasure(true);
            session.start();
        }
        void session.runLoad(id);
    };

    // The values stay after they leave the time window of the series
    const kept = useRef<BlockReport | undefined>(undefined);
    const report = keepMeasured(kept.current, snapshot ? snapshotReadings(snapshot) : undefined);
    kept.current = report;

    return (
        <aside className={`${styles.instrument} graph-paper`} aria-labelledby="instrument-title">
            <div className={styles.instrumentHeader}>
                <p id="instrument-title" className={styles.instrumentTitle}>This tab, measured live</p>
                <p className={styles.state} data-state={running ? "running" : "idle"} role="status">
                    <span className={styles.stateDot} aria-hidden="true" />
                    {running ? "Measuring" : "Not measuring"}
                </p>
            </div>

            <MotionLanes playing={playing} />

            <div className={styles.buttons} role="group" aria-label="Load the main thread of this page">
                {HERO_ACTIONS.map((id) => {
                    const action = LOAD_ACTIONS.find(candidate => candidate.id === id)!;
                    return (
                        <button key={id} type="button" className="button" title={action.description} disabled={!session || busy} onClick={() => run(id)}>
                            {action.label}
                        </button>
                    );
                })}
            </div>

            {error ? <p className={styles.note}>The monitors did not start: {error.message}</p> : null}
            {!running && !error ? (
                <p className={styles.note}>
                    {reducedMotion && measure === undefined
                        ? "The monitors start when you press a button or select \"Start the monitors\"."
                        : "The monitors start at your first input in this page. They operate only in this tab."}
                </p>
            ) : null}

            {snapshot ? <LiveStrip snapshot={snapshot} /> : <div className={styles.stripPlaceholder} />}
            <BlockReadout report={report} busy={busy} />

            <div className={styles.instrumentFooter}>
                <Link to="/playground" className={styles.playgroundLink}>Open the playground: all the monitors, the full timeline and workload profiles</Link>
                <span className={styles.toggles}>
                    <button type="button" className={styles.textButton} onClick={() => setMotion(!playing)}>
                        {playing ? "Stop the motion" : "Start the motion"}
                    </button>
                    <button type="button" className={styles.textButton} disabled={!session} onClick={() => setMeasure(!wanted)}>
                        {wanted ? "Stop the monitors" : "Start the monitors"}
                    </button>
                </span>
            </div>
        </aside>
    );
}
