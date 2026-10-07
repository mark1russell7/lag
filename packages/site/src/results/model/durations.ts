export type DurationBin = {
    label : string;
    /** Inclusive, in ms. */
    lower : number;
    /** Exclusive, in ms. Infinity for the last bin. */
    upper : number;
    count : number;
};

/** Bin edges in a 1-2-5 series, in ms. They are easy to read. */
const EDGES = [0, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000];

/** "0–1 ms" up to "500–1000 ms", then "1–2 s", and "50 s or more" for the last bin. */
function binLabel(lower : number, upper : number) : string {
    if (!Number.isFinite(upper)) return `${lower / 1000} s or more`;
    if (upper <= 1000) return `${lower}–${upper} ms`;
    return `${lower / 1000}–${upper / 1000} s`;
}

/**
 * Counts durations in 1-2-5 bins (0–1 ms, 1–2 ms, 2–5 ms, ...). The result
 * starts at the first bin with a value and stops at the last one.
 */
export function durationBins(values : readonly number[]) : DurationBin[] {
    const bins : DurationBin[] = EDGES.map((lower, index) => {
        const upper = EDGES[index + 1] ?? Number.POSITIVE_INFINITY;
        return { label : binLabel(lower, upper), lower, upper, count : 0 };
    });
    for (const value of values) {
        if (!Number.isFinite(value) || value < 0) continue;
        const bin = bins.find(candidate => value >= candidate.lower && value < candidate.upper);
        if (bin) bin.count++;
    }
    const first = bins.findIndex(bin => bin.count > 0);
    if (first < 0) return [];
    let last = bins.length - 1;
    while (last > first && bins[last]!.count === 0) last--;
    return bins.slice(first, last + 1);
}
