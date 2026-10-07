export type SortDirection = "ascending" | "descending";

export type SortState<K extends string> = {
    key : K;
    direction : SortDirection;
};

export type SortValue = string | number | undefined;

/**
 * Sorts rows by one column. Rows without a value go last in both
 * directions. Equal rows keep their order.
 */
export function sortRows<T, K extends string>(
    rows : readonly T[],
    state : SortState<K>,
    valueOf : (row : T, key : K) => SortValue,
) : T[] {
    const sign = state.direction === "ascending" ? 1 : -1;
    return rows
        .map((row, index) => ({ row, index, value : valueOf(row, state.key) }))
        .sort((a, b) => {
            if (a.value === undefined || b.value === undefined) {
                if (a.value === b.value) return a.index - b.index;
                return a.value === undefined ? 1 : -1;
            }
            const order = typeof a.value === "number" && typeof b.value === "number"
                ? a.value - b.value
                : String(a.value).localeCompare(String(b.value));
            return order === 0 ? a.index - b.index : order * sign;
        })
        .map(entry => entry.row);
}

/** The sort after a click on a column header: the same column changes direction; a new column starts with `initial`. */
export function nextSort<K extends string>(current : SortState<K>, key : K, initial : SortDirection = "ascending") : SortState<K> {
    if (current.key !== key) return { key, direction : initial };
    return { key, direction : current.direction === "ascending" ? "descending" : "ascending" };
}
