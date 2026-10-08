import type { PlaygroundSnapshot } from "./session";
import styles from "./Playground.module.css";

const STATE_TEXT : Readonly<Record<string, string>> = {
    active : "Active: the page shows and has the focus.",
    passive : "Passive: the page shows, but another window has the focus.",
    hidden : "Hidden: the page does not show. The timer monitors pause.",
    frozen : "Frozen: the browser stopped the tasks of the page.",
    terminated : "Terminated: the page is closing.",
};

/** The counters and the Page Lifecycle state. */
export function StatePanel({ snapshot } : { snapshot : PlaygroundSnapshot }) {
    const state = snapshot.lifecycleState;
    const transition = snapshot.lastTransition;
    return (
        <section className={styles.section} aria-labelledby="state-heading">
            <h2 id="state-heading">Counters and state</h2>
            <dl className={styles.counters}>
                <div>
                    <dt>Lifecycle state</dt>
                    <dd>{state ?? (snapshot.status === "running" ? "Unknown" : "Not measured")}</dd>
                </div>
                <div>
                    <dt>Lifecycle transitions</dt>
                    <dd>{snapshot.lifecycleTransitions}</dd>
                </div>
                <div>
                    <dt>Garbage collections seen</dt>
                    <dd>{snapshot.gcEvents}</dd>
                </div>
                <div>
                    <dt>Worker</dt>
                    <dd>{snapshot.workerRunning ? "Running" : "Not running"}</dd>
                </div>
            </dl>
            {state && STATE_TEXT[state] ? <p className={styles.note}>{STATE_TEXT[state]}</p> : null}
            <p className={styles.note}>
                {transition
                    ? `The last transition went from ${transition.from} to ${transition.to} (trigger: ${transition.trigger}).`
                    : "To make a transition, select another window, or hide this tab and then show it again."}
            </p>

            <details className={styles.log}>
                <summary>Monitor messages ({snapshot.log.length})</summary>
                {snapshot.log.length === 0 ? (
                    <p>The monitors sent no messages.</p>
                ) : (
                    <ol>
                        {snapshot.log.map((entry, index) => (
                            <li key={`${entry.t}-${index}`}>
                                <span className={styles.logLevel}>{entry.level}</span> at {entry.t.toFixed(1)} s: {entry.message}
                            </li>
                        ))}
                    </ol>
                )}
            </details>
        </section>
    );
}
