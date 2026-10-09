import { lazy, Suspense } from "react";
import { Link } from "react-router";
import { useSections } from "../app/SectionsContext";
import { HOME_HEADING, HOME_TITLE, SITE_NAME } from "../app/site";
import styles from "./Home.module.css";

const MainThreadIndicator = lazy(() => import("./MainThreadIndicator"));

/** The signals of the monitors, with the words that readers search for, and the page that tells more. */
const SIGNALS : ReadonlyArray<{ term : string; text : string; to : string; link : string }> = [
    {
        term : "Main-thread lag",
        text : "DriftLag measures how much of each 100 ms window other tasks block the main thread, with a timer baseline that it calibrates.",
        to : "/docs/monitors/drift-lag",
        link : "DriftLag",
    },
    {
        term : "Long tasks and Long Animation Frames",
        text : "The monitor records each frame of 50 ms or more, its blocking duration and, in Chromium, the scripts that caused it.",
        to : "/docs/monitors/long-animation-frames",
        link : "Long Animation Frames",
    },
    {
        term : "INP and the Web Vitals",
        text : "The page-view vitals give INP, CLS, LCP, FCP and TTFB for each page view, with the rules of web-vitals.",
        to : "/docs/monitors/page-view-vitals",
        link : "Page-view vitals",
    },
    {
        term : "Hangs, seen from a Web Worker",
        text : "A worker measures main-thread blocks while they occur, and reports the hangs that a page did not survive.",
        to : "/docs/monitors/worker-lag",
        link : "Worker lag",
    },
    {
        term : "Event loop lag",
        text : "Blocked time, queueing delay, frame delay and input latency are four different meanings of lag. Each has its monitor.",
        to : "/docs/concepts/event-loop",
        link : "The event loop",
    },
    {
        term : "OpenTelemetry browser metrics",
        text : "The monitors record counters and histograms that aggregate correctly over many browsers, for example in Grafana Mimir.",
        to : "/docs/concepts/metrics-model",
        link : "Metrics model",
    },
];

function IndicatorPlaceholder() {
    return (
        <aside className={`${styles.indicator} graph-paper`} aria-busy="true" aria-label="This tab">
            <p className={styles.indicatorText}>The monitor loads.</p>
        </aside>
    );
}

/** The home page: what the project is, a live reading of this tab, and the sections of the site. */
export function HomePage() {
    const sections = useSections().filter(section => section.card);
    return (
        <div className={styles.page}>
            <title>{HOME_TITLE}</title>
            <section className={styles.hero} aria-labelledby="home-title">
                <div className={styles.heroText}>
                    <h1 id="home-title" className={styles.title}>{HOME_HEADING}</h1>
                    <p className={styles.lead}>
                        <code>{SITE_NAME}</code> is a set of monitors for browser apps, for real user monitoring of the main
                        thread. Each monitor measures one signal of main-thread responsiveness, for example blocked time, long
                        tasks or input latency (INP), and records it as an OpenTelemetry metric. The monitors calibrate their
                        probes and discard the samples that are not valid. A Web Worker also measures the main thread from
                        outside.
                    </p>
                    <p className={styles.actions}>
                        <Link className="button" data-variant="primary" to="/docs/getting-started">Quick start</Link>
                        <Link className="button" to="/playground">Open the playground</Link>
                    </p>
                </div>
                <Suspense fallback={<IndicatorPlaceholder />}>
                    <MainThreadIndicator />
                </Suspense>
            </section>

            <section className={styles.signals} aria-labelledby="signals-title">
                <h2 id="signals-title" className={styles.sectionsTitle}>What the monitors measure</h2>
                <dl className={styles.signalList}>
                    {SIGNALS.map(signal => (
                        <div key={signal.to} className={styles.signal}>
                            <dt className={styles.signalTerm}>{signal.term}</dt>
                            <dd className={styles.signalText}>
                                {signal.text} <Link to={signal.to}>{signal.link}</Link>
                            </dd>
                        </div>
                    ))}
                </dl>
            </section>

            <section className={styles.sections} aria-labelledby="sections-title">
                <h2 id="sections-title" className={styles.sectionsTitle}>What this site holds</h2>
                <ul className={styles.cards}>
                    {sections.map(section => {
                        const Detail = section.card?.Detail;
                        return (
                            <li key={section.id} className={styles.card}>
                                <h3 className={styles.cardTitle}><Link to={section.path}>{section.label}</Link></h3>
                                <p className={styles.cardText}>{section.card?.summary}</p>
                                {Detail ? <Detail /> : null}
                            </li>
                        );
                    })}
                </ul>
            </section>
        </div>
    );
}
