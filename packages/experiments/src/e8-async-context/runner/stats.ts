/** The statistics of the runner. The functions do no I/O. */

import { median } from "@mark1russell7/rigor-statistics";

/**
 * This function gives the median of the values, with `median` of rigor-statistics. For a list with no values or with
 * a `NaN`, it gives `NaN`, and the tables show no value. The home throws on such a list.
 */
export function medianOrNaN(values : readonly number[]) : number {
    if (values.length === 0 || values.some(value => Number.isNaN(value))) return Number.NaN;
    return median(values);
}

/** The median, the lowest and the highest value, and the count. */
export type Spread = { median : number; min : number; max : number; n : number };

/** This function gives the spread of the finite values. A spread of no values has `NaN` values and `n: 0`. */
export function spread(values : readonly number[]) : Spread {
    const finite = values.filter(value => Number.isFinite(value));
    if (finite.length === 0) return { median : Number.NaN, min : Number.NaN, max : Number.NaN, n : 0 };
    return { median : median(finite), min : Math.min(...finite), max : Math.max(...finite), n : finite.length };
}
