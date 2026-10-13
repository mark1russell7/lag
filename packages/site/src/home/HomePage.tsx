import { Link } from "react-router";
import { useSections } from "../app/SectionsContext";
import { HOME_HEADING, HOME_TITLE, SITE_NAME } from "../app/site";
import { FourLags } from "../components/FourLags/FourLags";
import { CodeBlock, CommandLine } from "./CodeBlock";
import { INSTALL_COMMAND, USAGE_CODE } from "./code";
import { HeroInstrument } from "./hero/HeroInstrument";
import { ProofStrip } from "./ProofStrip";
import styles from "./Home.module.css";

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

/** The steps of the usage example, as the README tells them. */
const STEPS : readonly string[] = [
    "Make an OpenTelemetry meter. Each OpenTelemetry Meter works.",
    "Start the worker. It measures the main thread from outside.",
    "Start the monitors. Each browser gets the monitors that it supports.",
    "When the page becomes hidden, record the final values of the page view, then export them.",
];

/** The heading, with a red pencil line under its last word. */
function Heading() {
    const split = HOME_HEADING.lastIndexOf(" ");
    return (
        <h1 id="home-title" className={styles.title}>
            {HOME_HEADING.slice(0, split + 1)}
            <span className={styles.pencil}>{HOME_HEADING.slice(split + 1)}</span>
        </h1>
    );
}

/**
 * The home page. It tells what the project is, and it has a live
 * instrument of this tab and the evidence of the tests. It also has an
 * interactive figure of the four meanings of lag, the usage example and the
 * sections of the site.
 */
export function HomePage() {
    const sections = useSections().filter(section => section.card);
    return (
        <div className={styles.page}>
            <title>{HOME_TITLE}</title>
            <section className={styles.hero} aria-labelledby="home-title">
                <div className={styles.heroText}>
                    <p className={styles.kicker}>Real user monitoring of the main thread, for OpenTelemetry</p>
                    <Heading />
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
                    <CommandLine command={INSTALL_COMMAND} />
                    <p className={styles.tryIt}>
                        <span className={styles.tryArrow} aria-hidden="true" />
                        Try it in this tab: press a button in the panel. The first dot stops, because the main thread is busy.
                        The second dot continues, because the compositor moves it.
                    </p>
                </div>
                <HeroInstrument />
            </section>

            <ProofStrip />

            <section className={styles.band} aria-labelledby="four-lags-title">
                <div className={styles.bandIntro}>
                    <h2 id="four-lags-title" className={styles.sectionTitle}>One block, four meanings of lag</h2>
                    <p className={styles.sectionLead}>
                        A long task blocks the main thread. Four monitors measure it, and each monitor gives a different value,
                        because each one answers a different question. Move the click and change the task: the figure
                        calculates what each monitor sees. <Link to="/docs/concepts/event-loop">The event loop</Link> page
                        tells you more.
                    </p>
                </div>
                <FourLags />
            </section>

            <section className={styles.signals} aria-labelledby="signals-title">
                <h2 id="signals-title" className={styles.sectionTitle}>What the monitors measure</h2>
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

            <section className={styles.usage} aria-labelledby="usage-title">
                <div>
                    <h2 id="usage-title" className={styles.sectionTitle}>Add the monitors to an app</h2>
                    <ol className={styles.steps}>
                        {STEPS.map(step => <li key={step}>{step}</li>)}
                    </ol>
                    <p className={styles.sectionLead}>
                        The <Link to="/docs/getting-started">quick start</Link> adds the events, the spans and the hang
                        reports of the worker. The <Link to="/docs/api">API reference</Link> lists each export.
                    </p>
                </div>
                <CodeBlock code={USAGE_CODE} title="main.ts, with the OpenTelemetry SDK" />
            </section>

            <section className={styles.sections} aria-labelledby="sections-title">
                <h2 id="sections-title" className={styles.sectionTitle}>What this site holds</h2>
                <ul className={styles.cards}>
                    {sections.map((section, index) => {
                        const Detail = section.card?.Detail;
                        return (
                            <li key={section.id} className={styles.card}>
                                <p className={styles.cardIndex} aria-hidden="true">{String(index + 1).padStart(2, "0")}</p>
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
