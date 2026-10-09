import { useEffect } from "react";
import { Callout } from "../components/Callout/Callout";
import { SITE_NAME } from "../app/site";
import { LiveChart } from "./LiveChart";
import { LoadPanel } from "./LoadPanel";
import type { PlaygroundSession, PlaygroundSnapshot } from "./session";
import { StatePanel } from "./StatePanel";
import { SessionTimeline } from "./timeline/SessionTimeline";
import { useSession } from "./use-session";
import styles from "./Playground.module.css";

function SessionBar({ session, snapshot } : { session : PlaygroundSession; snapshot : PlaygroundSnapshot }) {
    const running = snapshot.status === "running";
    return (
        <div className={styles.sessionBar}>
            <p className={styles.sessionStatus}>
                <span className={styles.dot} data-running={running ? "true" : undefined} aria-hidden="true" />
                {running ? `The monitors operate (${Math.floor(snapshot.elapsedSeconds)} s).` : "The monitors are stopped."}
            </p>
            {running ? (
                <button type="button" className="button" onClick={() => session.stop()}>Stop the monitors</button>
            ) : (
                <button type="button" className="button" data-variant="primary" onClick={() => session.start()}>
                    Start the monitors
                </button>
            )}
        </div>
    );
}

function Charts({ snapshot } : { snapshot : PlaygroundSnapshot }) {
    const common = { windowSeconds : snapshot.windowSeconds, elapsedSeconds : snapshot.elapsedSeconds };
    return (
        <section className={styles.section} aria-labelledby="charts-heading">
            <h2 id="charts-heading">What the monitors record</h2>
            <p className={styles.lead}>The charts show the last {snapshot.windowSeconds} s. They update two times each second.</p>
            <div className={styles.charts}>
                <LiveChart
                    {...common}
                    title="Timer drift (DriftLag)"
                    description="How late each 100 ms window of chained 5 ms timeouts ends. A blocked main thread makes the window end late."
                    series={snapshot.series.drift}
                    mark="line"
                    emptyText="No values yet. DriftLag reports one value for each 100 ms window."
                />
                <LiveChart
                    {...common}
                    title="Main-thread block, seen by the worker"
                    description="How long each worker heartbeat waits until the main thread handles it."
                    series={snapshot.series.workerBlock}
                    mark="line"
                    emptyText="No values. The browser did not start the worker, or the first heartbeats did not arrive yet."
                />
                <LiveChart
                    {...common}
                    title="Frame delta"
                    description="The time between two animation frame callbacks. At 60 Hz, a frame takes 16.7 ms."
                    series={snapshot.series.frameDelta}
                    mark="line"
                    reference={{ value : 16.7, label : "One frame at 60 Hz" }}
                    emptyText="No frames yet. The browser does not run animation frames while the tab is hidden."
                />
                <LiveChart
                    {...common}
                    title="Event duration"
                    description="The duration of each interaction event of 16 ms or more, from the Event Timing API."
                    series={snapshot.series.eventDuration}
                    mark="dot"
                    emptyText="No events at this time. Select a load button: a blocked click makes a long event."
                />
            </div>
        </section>
    );
}

function Timeline({ snapshot } : { snapshot : PlaygroundSnapshot }) {
    return (
        <section className={styles.section} aria-labelledby="timeline-heading">
            <h2 id="timeline-heading">Session timeline</h2>
            <p className={styles.lead}>
                The timeline shows what the monitors recorded in this session: their metrics, their events and their spans, on
                one time axis. Make load above, and look for the long frames, the lag and the hangs that it causes.
            </p>
            <SessionTimeline model={snapshot.timeline} />
        </section>
    );
}

/** A live demo that runs the real monitors in this page. */
export function PlaygroundPage() {
    const { session, snapshot, error } = useSession("full");

    useEffect(() => {
        session?.start();
    }, [session]);

    return (
        <div className={styles.page}>
            <title>{`Playground – ${SITE_NAME}`}</title>
            <header className={styles.header}>
                <h1>Playground</h1>
                <p className={styles.intro}>
                    This page starts the monitors of <code>@mark1russell7/lag</code> in your browser, with a Web Worker from{" "}
                    <code>@mark1russell7/lag/worker</code>. Use the buttons to make main-thread load. Then look at what the monitors record.
                </p>
                {session && snapshot ? <SessionBar session={session} snapshot={snapshot} /> : null}
            </header>

            {error ? (
                <Callout type="warning" title="The monitors did not load">{error.message}</Callout>
            ) : null}
            {snapshot?.status === "failed" ? (
                <Callout type="warning" title="The monitors did not start">{snapshot.error}</Callout>
            ) : null}
            {!session && !error ? <p aria-busy="true">The monitors load.</p> : null}

            {session && snapshot ? (
                <>
                    <LoadPanel session={session} snapshot={snapshot} />
                    <Timeline snapshot={snapshot} />
                    <Charts snapshot={snapshot} />
                    <StatePanel snapshot={snapshot} />
                </>
            ) : null}
        </div>
    );
}
