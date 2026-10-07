/** Statistics for measured values. Percentiles use the nearest-rank method: the result is always a measured value. */

export function sortedValues(values : readonly number[]) : number[] {
    return values.filter(Number.isFinite).sort((a, b) => a - b);
}

/**
 * The nearest-rank percentile of sorted values: the smallest value that has
 * at least `p` percent of the values at or below it.
 */
export function percentile(sorted : readonly number[], p : number) : number | undefined {
    if (sorted.length === 0) return undefined;
    if (p <= 0) return sorted[0];
    const rank = Math.ceil((p / 100) * sorted.length);
    return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

export type Summary = {
    count : number;
    min : number | undefined;
    max : number | undefined;
    mean : number | undefined;
    p50 : number | undefined;
    p95 : number | undefined;
    p99 : number | undefined;
};

export function summarize(values : readonly number[]) : Summary {
    const sorted = sortedValues(values);
    const sum = sorted.reduce((total, value) => total + value, 0);
    return {
        count : sorted.length,
        min : sorted[0],
        max : sorted[sorted.length - 1],
        mean : sorted.length > 0 ? sum / sorted.length : undefined,
        p50 : percentile(sorted, 50),
        p95 : percentile(sorted, 95),
        p99 : percentile(sorted, 99),
    };
}

export type EcdfPoint = {
    value : number;
    /** The fraction of values at or below `value`, from 0 to 1. */
    fraction : number;
};

/**
 * The empirical cumulative distribution. For many values, it keeps at most
 * `maxPoints` points at evenly spaced ranks, plus the minimum.
 */
export function ecdf(values : readonly number[], maxPoints = 400) : EcdfPoint[] {
    const sorted = sortedValues(values);
    const n = sorted.length;
    if (n === 0) return [];
    if (n <= maxPoints) return sorted.map((value, index) => ({ value, fraction : (index + 1) / n }));
    const points : EcdfPoint[] = [{ value : sorted[0]!, fraction : 1 / n }];
    for (let k = 1; k <= maxPoints; k++) {
        const index = Math.ceil((k / maxPoints) * n) - 1;
        points.push({ value : sorted[index]!, fraction : (index + 1) / n });
    }
    return points;
}

export type Bin = {
    /** Lower edge (inclusive). */
    x0 : number;
    /** Upper edge (exclusive, except for the last bin). */
    x1 : number;
    count : number;
};

const toSymlog = (x : number) : number => Math.sign(x) * Math.log1p(Math.abs(x));
const fromSymlog = (t : number) : number => Math.sign(t) * Math.expm1(Math.abs(t));

/**
 * Bins with equal width on a symmetric log scale (log(1 + x)). Lag values
 * have a long tail and can be 0, so a linear or a plain log scale does not
 * show them well.
 */
export function symlogBins(values : readonly number[], binCount = 24) : Bin[] {
    const sorted = sortedValues(values);
    if (sorted.length === 0) return [];
    const min = sorted[0]!;
    const max = sorted[sorted.length - 1]!;
    if (min === max) return [{ x0 : min, x1 : min + 1, count : sorted.length }];

    const t0 = toSymlog(min);
    const step = (toSymlog(max) - t0) / binCount;
    const bins : Bin[] = Array.from({ length : binCount }, (_, index) => ({
        x0 : fromSymlog(t0 + index * step),
        x1 : fromSymlog(t0 + (index + 1) * step),
        count : 0,
    }));
    for (const value of sorted) {
        const index = Math.min(binCount - 1, Math.floor((toSymlog(value) - t0) / step));
        bins[index]!.count++;
    }
    // Make the outer edges exact (the inverse transform can round).
    bins[0]!.x0 = min;
    bins[binCount - 1]!.x1 = max;
    return bins;
}

export type TimePoint = {
    t : number;
    value : number;
};

/**
 * Reduces a series to at most `maxPoints` points. Each bucket keeps its
 * highest value, so short spikes stay visible.
 */
export function downsampleMax<P extends TimePoint>(points : readonly P[], maxPoints : number) : P[] {
    if (points.length <= maxPoints || maxPoints < 1) return [...points];
    const bucketSize = points.length / maxPoints;
    const result : P[] = [];
    for (let bucket = 0; bucket < maxPoints; bucket++) {
        const start = Math.floor(bucket * bucketSize);
        const end = Math.min(points.length, Math.floor((bucket + 1) * bucketSize));
        let best : P | undefined;
        for (let index = start; index < end; index++) {
            const point = points[index]!;
            if (!best || point.value > best.value) best = point;
        }
        if (best) result.push(best);
    }
    return result;
}
