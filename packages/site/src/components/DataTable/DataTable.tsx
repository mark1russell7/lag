import { useState } from "react";
import { ScrollTable } from "../ScrollTable/ScrollTable";
import styles from "./DataTable.module.css";

export type DataTableColumn = {
    key : string;
    label : string;
    /** Numbers align right. */
    align? : "left" | "right";
    format? : (value : unknown) => string;
};

/** A table that gives the same data as a chart, for readers who cannot see the chart. */
export type DataTableSpec = {
    caption? : string;
    columns : readonly DataTableColumn[];
    rows : ReadonlyArray<Readonly<Record<string, unknown>>>;
};

function cellText(value : unknown, column : DataTableColumn) : string {
    if (column.format) return column.format(value);
    if (value === undefined || value === null) return "–";
    if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
    if (value instanceof Date) return value.toISOString();
    return String(value);
}

export function DataTable({ spec, label } : { spec : DataTableSpec; label : string }) {
    return (
        <ScrollTable label={label}>
            <table className={styles.table}>
                {spec.caption ? <caption>{spec.caption}</caption> : null}
                <thead>
                    <tr>
                        {spec.columns.map(column => (
                            <th key={column.key} scope="col" data-align={column.align ?? "left"}>{column.label}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {spec.rows.map((row, index) => (
                        <tr key={index}>
                            {spec.columns.map(column => (
                                <td key={column.key} data-align={column.align ?? "left"}>{cellText(row[column.key], column)}</td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </ScrollTable>
    );
}

export type DataTableDisclosureProps = {
    /** The table, or a function that makes it. With `lazy`, the function operates only while the disclosure is open. */
    spec : DataTableSpec | (() => DataTableSpec);
    title : string;
    /** When true, the table renders only while the disclosure is open. A live chart that updates frequently uses it. */
    lazy? : boolean;
};

/** A data table behind a disclosure, under a chart. */
export function DataTableDisclosure({ spec, title, lazy = false } : DataTableDisclosureProps) {
    const [open, setOpen] = useState(false);
    const show = !lazy || open;
    return (
        <details className={styles.disclosure} onToggle={(event) => setOpen(event.currentTarget.open)}>
            <summary>Show the data as a table</summary>
            {show ? <DataTable spec={typeof spec === "function" ? spec() : spec} label={`Data: ${title}`} /> : null}
        </details>
    );
}
