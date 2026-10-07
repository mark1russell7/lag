import { lazy, Suspense } from "react";
import { Link } from "react-router";
import { useSections } from "../app/SectionsContext";
import { SITE_NAME } from "../app/site";
import styles from "./Home.module.css";

const MainThreadIndicator = lazy(() => import("./MainThreadIndicator"));

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
            <title>{`${SITE_NAME}: main-thread responsiveness`}</title>
            <section className={styles.hero} aria-labelledby="home-title">
                <div className={styles.heroText}>
                    <h1 id="home-title" className={styles.title}>Measure how long the main thread makes users wait</h1>
                    <p className={styles.lead}>
                        <code>{SITE_NAME}</code> is a set of monitors for browser apps. Each monitor measures one signal of
                        main-thread responsiveness and records it as an OpenTelemetry metric. The monitors calibrate their
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
