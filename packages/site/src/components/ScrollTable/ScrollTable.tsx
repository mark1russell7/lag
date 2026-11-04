import type { ReactNode, TableHTMLAttributes } from "react";
import styles from "./ScrollTable.module.css";

export type ScrollTableProps = {
    /** The accessible name of the scroll region. */
    label : string;
    children : ReactNode;
};

/**
 * A region that scrolls a wide table sideways, so the page itself does not
 * scroll. The region can get keyboard focus, so a keyboard can scroll it.
 * The class `scroll-cue` shows a shade at each edge that has more content.
 */
export function ScrollTable({ label, children } : ScrollTableProps) {
    return (
        <div className={`${styles.scroll} scroll-cue`} role="region" aria-label={label} tabIndex={0}>
            {children}
        </div>
    );
}

/** The MDX override for Markdown tables. */
export function MarkdownTable(props : TableHTMLAttributes<HTMLTableElement>) {
    return (
        <ScrollTable label="Table">
            <table {...props} />
        </ScrollTable>
    );
}
