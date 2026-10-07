import { useState, type ReactNode } from "react";
import { ScrollTable } from "../../components/ScrollTable/ScrollTable";
import { nextSort, sortRows, type SortDirection, type SortState, type SortValue } from "../model/sort";
import styles from "./SortableTable.module.css";

export type Column<T, K extends string> = {
    key : K;
    label : string;
    /** Numbers align right, and their first sort is descending. */
    align? : "left" | "right";
    render : (row : T) => ReactNode;
    /** Makes the column sortable. */
    sortValue? : (row : T) => SortValue;
    /** Renders the cell as the header of its row. */
    rowHeader? : boolean;
};

export type SortableTableProps<T, K extends string> = {
    /** The accessible name of the table region. */
    label : string;
    caption? : string;
    columns : ReadonlyArray<Column<T, K>>;
    rows : readonly T[];
    rowKey : (row : T) => string;
    initialSort : SortState<K>;
};

function SortMark({ direction } : { direction : SortDirection | undefined }) {
    return (
        <svg className={styles.mark} viewBox="0 0 12 12" aria-hidden="true" focusable="false" data-direction={direction}>
            <path d="M3 5 6 2 9 5" fill="none" stroke="currentColor" strokeWidth="1.4" className={styles.up} />
            <path d="M3 7 6 10 9 7" fill="none" stroke="currentColor" strokeWidth="1.4" className={styles.down} />
        </svg>
    );
}

/** A table with column headers that sort the rows. The header of the sorted column has `aria-sort`. */
export function SortableTable<T, K extends string>({ label, caption, columns, rows, rowKey, initialSort } : SortableTableProps<T, K>) {
    const [sort, setSort] = useState<SortState<K>>(initialSort);
    const sortColumn = columns.find(column => column.key === sort.key);
    const sorted = sortColumn?.sortValue
        ? sortRows(rows, sort, (row) => sortColumn.sortValue!(row))
        : [...rows];

    return (
        <ScrollTable label={label}>
            <table className={styles.table}>
                {caption ? <caption>{caption}</caption> : null}
                <thead>
                    <tr>
                        {columns.map(column => {
                            const active = sort.key === column.key;
                            return (
                                <th
                                    key={column.key}
                                    scope="col"
                                    data-align={column.align ?? "left"}
                                    aria-sort={column.sortValue ? (active ? sort.direction : "none") : undefined}
                                >
                                    {column.sortValue ? (
                                        <button
                                            type="button"
                                            className={styles.sortButton}
                                            onClick={() => setSort(current => nextSort(current, column.key, column.align === "right" ? "descending" : "ascending"))}
                                        >
                                            {column.label}
                                            <SortMark direction={active ? sort.direction : undefined} />
                                        </button>
                                    ) : column.label}
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody>
                    {sorted.map(row => (
                        <tr key={rowKey(row)}>
                            {columns.map(column => (column.rowHeader
                                ? <th key={column.key} scope="row" data-align={column.align ?? "left"}>{column.render(row)}</th>
                                : <td key={column.key} data-align={column.align ?? "left"}>{column.render(row)}</td>))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </ScrollTable>
    );
}
