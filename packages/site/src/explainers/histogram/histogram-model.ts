import { percentile, sortedValues } from "../../lib/stats";

/**
 * The model of the aggregation explainer: some browsers record latency
 * samples, and a dashboard wants the 95th percentile of all samples. The
 * model compares the mean of the percentile of each browser with the
 * percentile of the merged histogram buckets.
 */

export type BrowserLoad = {
    name : string;
    /** The number of samples of the browser. */
    samples : number;
    /** The median latency, in ms. */
    medianMs : number;
    /** The standard deviation of the natural logarithm of the latency. */
    spread : number;
};

/**
 * The quantile function of the standard normal distribution, with the
 * rational approximation of Peter Acklam (relative error below 1.2e-9).
 */
export function normalQuantile(p : number) : number {
    if (p <= 0) return -Infinity;
    if (p >= 1) return Infinity;
    const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
    const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
    const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
    const low = 0.02425;
    if (p < low) {
        const q = Math.sqrt(-2 * Math.log(p));
        return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
    }
    if (p > 1 - low) return -normalQuantile(1 - p);
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q
        / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/**
 * The samples of a browser: a log-normal distribution with the median and
 * the spread of the load. The samples are at equal steps of probability, not
 * random. Thus the same load always gives the same samples.
 */
export function samplesOf(load : BrowserLoad) : number[] {
    const count = Math.max(0, Math.round(load.samples));
    return Array.from({ length : count }, (_, index) => load.medianMs * Math.exp(load.spread * normalQuantile((index + 0.5) / count)));
}

/**
 * The number of samples in each bucket. Bucket `i` holds the values above
 * `boundaries[i − 1]` and at or below `boundaries[i]`, as in OpenTelemetry.
 * The last bucket holds the values above the last boundary.
 */
export function bucketCounts(values : readonly number[], boundaries : readonly number[]) : number[] {
    const counts = new Array<number>(boundaries.length + 1).fill(0);
    for (const value of values) {
        let index = boundaries.findIndex(boundary => value <= boundary);
        if (index === -1) index = boundaries.length;
        counts[index]!++;
    }
    return counts;
}

/**
 * The quantile `q` (from 0 to 1) of a histogram, as `histogram_quantile()`
 * of PromQL gives it. It finds the bucket of the rank, and it interpolates
 * linearly in that bucket. The lowest bucket starts at 0. A rank in the
 * last bucket gives the last boundary.
 */
export function histogramQuantile(q : number, boundaries : readonly number[], counts : readonly number[]) : number | undefined {
    const total = counts.reduce((sum, count) => sum + count, 0);
    if (total === 0) return undefined;
    const rank = q * total;
    let cumulative = 0;
    for (let index = 0; index < counts.length; index++) {
        const count = counts[index]!;
        const before = cumulative;
        cumulative += count;
        if (count === 0 || cumulative < rank) continue;
        if (index === boundaries.length) return boundaries[boundaries.length - 1];
        const upper = boundaries[index]!;
        const lower = index === 0 ? Math.min(0, upper) : boundaries[index - 1]!;
        return lower + (upper - lower) * ((rank - before) / count);
    }
    return boundaries[boundaries.length - 1];
}

export type BucketRow = {
    lower : number;
    upper : number;
    /** The count of each browser, in the sequence of the loads. */
    counts : readonly number[];
};

export type AggregationResult = {
    browsers : ReadonlyArray<{ name : string; samples : number; p95 : number | undefined }>;
    /** The mean of the 95th percentiles of the browsers: the wrong aggregation. */
    meanOfPercentiles : number | undefined;
    /** The 95th percentile of all samples together: the correct value. */
    pooled : number | undefined;
    /** The 95th percentile of the merged histogram, as `histogram_quantile()` gives it. */
    fromHistogram : number | undefined;
    /** The buckets that have samples. */
    buckets : readonly BucketRow[];
};

/** The samples of one browser. */
export type BrowserSamples = { name : string; values : readonly number[] };

/** This function compares the two aggregations of the 95th percentile of the samples of some browsers. */
export function aggregateSamples(sets : readonly BrowserSamples[], boundaries : readonly number[]) : AggregationResult {
    const samples = sets.map(set => set.values);
    const browsers = sets.map((set, index) => ({ name : set.name, samples : samples[index]!.length, p95 : percentile(sortedValues(samples[index]!), 95) }));
    const percentiles = browsers.map(browser => browser.p95).filter((value) : value is number => value !== undefined);
    const perBrowser = samples.map(values => bucketCounts(values, boundaries));
    const merged = boundaries.map((_, index) => perBrowser.reduce((sum, counts) => sum + counts[index]!, 0)).concat(
        perBrowser.reduce((sum, counts) => sum + counts[boundaries.length]!, 0),
    );
    const buckets : BucketRow[] = [];
    for (let index = 0; index <= boundaries.length; index++) {
        if (merged[index] === 0) continue;
        buckets.push({
            lower : index === 0 ? 0 : boundaries[index - 1]!,
            upper : index === boundaries.length ? Infinity : boundaries[index]!,
            counts : perBrowser.map(counts => counts[index]!),
        });
    }
    return {
        browsers,
        meanOfPercentiles : percentiles.length > 0 ? percentiles.reduce((sum, value) => sum + value, 0) / percentiles.length : undefined,
        pooled : percentile(sortedValues(samples.flat()), 95),
        fromHistogram : histogramQuantile(0.95, boundaries, merged),
        buckets,
    };
}

/** This function compares the two aggregations of the 95th percentile for the loads of some browsers. */
export function aggregate(loads : readonly BrowserLoad[], boundaries : readonly number[]) : AggregationResult {
    return aggregateSamples(loads.map(load => ({ name : load.name, values : samplesOf(load) })), boundaries);
}
