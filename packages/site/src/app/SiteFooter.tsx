import { Link } from "react-router";
import { SITE_NAME, SITE_TAGLINE } from "./site";
import styles from "./SiteFooter.module.css";

export function SiteFooter() {
    return (
        <footer className={styles.footer}>
            <div className={styles.inner}>
                <p className={styles.text}>
                    <strong>{SITE_NAME}</strong>: {SITE_TAGLINE}
                </p>
                <p className={styles.text}>
                    To change a page, edit its file in <code>packages/site/content/</code>. The{" "}
                    <Link to="/docs/contributing/writing-style">writing style guide</Link> tells you how.
                </p>
            </div>
        </footer>
    );
}
