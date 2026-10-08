import { useId } from "react";
import { ScrollTable } from "../ScrollTable/ScrollTable";
import type { SupportBrowser, SupportCell, SupportFootnote, SupportRow, SupportStatus } from "./types";
import styles from "./SupportMatrix.module.css";

export const DEFAULT_BROWSERS : readonly SupportBrowser[] = [
    { id : "chrome", label : "Chrome" },
    { id : "edge", label : "Edge" },
    { id : "firefox", label : "Firefox" },
    { id : "safari", label : "Safari" },
];

const STATUS_LABELS : Readonly<Record<SupportStatus, string>> = {
    supported : "Yes",
    partial : "Partial",
    unsupported : "No",
    unknown : "Unknown",
};

function StatusShape({ status } : { status : SupportStatus }) {
    switch (status) {
        case "supported":
            return <path d="M5 10.5 8.5 14 15 6.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />;
        case "partial":
            return (
                <>
                    <circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M10 4a6 6 0 0 1 0 12Z" fill="currentColor" />
                </>
            );
        case "unsupported":
            return <path d="M6 6l8 8M14 6l-8 8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />;
        case "unknown":
            return <path d="M7.5 7.5a2.5 2.5 0 1 1 3.3 2.4c-.5.2-.8.7-.8 1.2v.6M10 14.3v.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />;
    }
}

export type SupportMatrixProps = {
    rows : readonly SupportRow[];
    browsers? : readonly SupportBrowser[];
    footnotes? : readonly SupportFootnote[];
    caption? : string;
};

/** A table of features by browser. Each cell shows a status, an optional version and footnote marks. */
export function SupportMatrix({ rows, browsers = DEFAULT_BROWSERS, footnotes = [], caption } : SupportMatrixProps) {
    const baseId = useId();
    const footnoteNumber = new Map(footnotes.map((note, index) => [note.id, index + 1]));
    const footnoteId = (id : string) : string => `${baseId}-note-${id}`;

    const renderCell = (cell : SupportCell) => (
        <span className={styles.cell} data-status={cell.status}>
            <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
                <StatusShape status={cell.status} />
            </svg>
            <span>
                {STATUS_LABELS[cell.status]}
                {cell.version ? <span className={styles.version}> {cell.version}</span> : null}
            </span>
            {(cell.notes ?? []).map((note) => {
                const number = footnoteNumber.get(note);
                if (number === undefined) return null;
                return (
                    <sup key={note} className={styles.mark}>
                        <a href={`#${footnoteId(note)}`} aria-label={`Note ${number}`}>{number}</a>
                    </sup>
                );
            })}
        </span>
    );

    return (
        <div className={styles.matrix}>
            <ScrollTable label={caption ?? "Browser support"}>
                <table className={styles.table}>
                    {caption ? <caption>{caption}</caption> : null}
                    <thead>
                        <tr>
                            <th scope="col">Feature</th>
                            {browsers.map(browser => <th key={browser.id} scope="col">{browser.label}</th>)}
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(row => (
                            <tr key={row.feature}>
                                <th scope="row">
                                    <span className={styles.feature}>{row.feature}</span>
                                    {row.api ? <code className={styles.api}>{row.api}</code> : null}
                                </th>
                                {browsers.map(browser => (
                                    <td key={browser.id}>{renderCell(row.cells[browser.id] ?? { status : "unknown" })}</td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </ScrollTable>
            {footnotes.length > 0 ? (
                <ol className={styles.footnotes} aria-label="Notes">
                    {footnotes.map(note => <li key={note.id} id={footnoteId(note.id)}>{note.text}</li>)}
                </ol>
            ) : null}
        </div>
    );
}
