/** The statistics of the runner. The functions do no I/O. */

/** The median: the middle value, or the mean of the two middle values. `NaN` for no values. */
export function median(values : readonly number[]) : number {
    if (values.length === 0) return Number.NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** The quantile `q` (0 to 1) with the nearest-rank method. `NaN` for no values. */
export function quantile(values : readonly number[], q : number) : number {
    if (values.length === 0) return Number.NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const rank = Math.max(1, Math.ceil(q * sorted.length));
    return sorted[Math.min(rank, sorted.length) - 1]!;
}

/** The median, the lowest and the highest value, and the count. */
export type Spread = { median : number; min : number; max : number; n : number };

/** This function gives the spread of the finite values. A spread of no values has `NaN` values and `n: 0`. */
export function spread(values : readonly number[]) : Spread {
    const finite = values.filter(value => Number.isFinite(value));
    if (finite.length === 0) return { median : Number.NaN, min : Number.NaN, max : Number.NaN, n : 0 };
    return { median : median(finite), min : Math.min(...finite), max : Math.max(...finite), n : finite.length };
}
