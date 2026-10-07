import { useId, useState } from "react";
import type { ProfileId } from "../adapters/lag-load";
import { formatMs } from "../lib/format";
import { LOAD_ACTIONS, PROFILES, loadLabel } from "./catalog";
import type { PlaygroundSession, PlaygroundSnapshot } from "./session";
import styles from "./Playground.module.css";

const PROFILE_SECONDS = 10;

function activeText(snapshot : PlaygroundSnapshot) : string {
    const load = snapshot.activeLoad;
    if (!load) return "";
    return `Running: ${loadLabel(load.kind, load.id)}.`;
}

export type LoadPanelProps = {
    session : PlaygroundSession;
    snapshot : PlaygroundSnapshot;
};

/** The buttons that make main-thread load, and the list of recent loads. */
export function LoadPanel({ session, snapshot } : LoadPanelProps) {
    const [profile, setProfile] = useState<ProfileId>("moderate");
    const selectId = useId();
    const canRun = snapshot.status === "running" && snapshot.activeLoad === undefined;
    const profileRunning = snapshot.activeLoad?.kind === "profile";
    const selectedProfile = PROFILES.find(candidate => candidate.id === profile);

    return (
        <section className={styles.section} aria-labelledby="load-heading">
            <h2 id="load-heading">Make load</h2>
            <p className={styles.lead}>
                Each button loads the main thread of this page. A button that blocks the main thread also makes a long
                interaction, so the event chart shows it too.
            </p>
            <ul className={styles.actions}>
                {LOAD_ACTIONS.map(action => (
                    <li key={action.id}>
                        <button
                            type="button"
                            className="button"
                            disabled={!canRun}
                            onClick={() => { void session.runLoad(action.id); }}
                        >
                            {action.label}
                        </button>
                        <span className={styles.actionText}>{action.description}</span>
                    </li>
                ))}
            </ul>

            <div className={styles.profile}>
                <label htmlFor={selectId}>Workload profile</label>
                <select
                    id={selectId}
                    className="control"
                    value={profile}
                    onChange={(event) => setProfile(event.target.value as ProfileId)}
                >
                    {PROFILES.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
                {profileRunning ? (
                    <button type="button" className="button" onClick={() => session.stopProfile()}>
                        Stop the profile
                    </button>
                ) : (
                    <button
                        type="button"
                        className="button"
                        data-variant="primary"
                        disabled={!canRun}
                        onClick={() => { void session.runProfile(profile, PROFILE_SECONDS * 1000); }}
                    >
                        Run the profile for {PROFILE_SECONDS} s
                    </button>
                )}
                {selectedProfile ? <p className={styles.profileText}>{selectedProfile.description}</p> : null}
            </div>

            <p className={styles.status} role="status">{activeText(snapshot)}</p>

            {snapshot.history.length > 0 ? (
                <div className={styles.history}>
                    <p className={styles.historyTitle}>Recent loads</p>
                    <ol>
                        {snapshot.history.map(record => (
                            <li key={`${record.kind}-${record.id}-${record.startedAt}`}>
                                {loadLabel(record.kind, record.id)} at {record.startedAt.toFixed(1)} s, for {formatMs(record.durationMs)}
                                {record.aborted ? " (stopped)" : ""}
                            </li>
                        ))}
                    </ol>
                </div>
            ) : null}
        </section>
    );
}
