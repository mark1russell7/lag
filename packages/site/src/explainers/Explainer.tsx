import { useId, type ReactNode } from "react";
import styles from "./Explainer.module.css";

export type ExplainerProps = {
    title : string;
    /** The text under the explainer: what it shows, and what it leaves out. */
    caption : ReactNode;
    /** The text of the badge. The default is "Interactive". */
    badge? : string;
    children : ReactNode;
};

/** The frame of an interactive explainer: a figure with a title, its content and a caption. */
export function Explainer({ title, caption, badge = "Interactive", children } : ExplainerProps) {
    const titleId = useId();
    return (
        <figure className={styles.explainer} aria-labelledby={titleId}>
            <div className={`${styles.header} graph-paper`}>
                <span className={styles.badge}>{badge}</span>
                <p id={titleId} className={styles.title}>{title}</p>
            </div>
            <div className={styles.body}>{children}</div>
            <figcaption className={styles.caption}>{caption}</figcaption>
        </figure>
    );
}

export { styles as explainerStyles };
