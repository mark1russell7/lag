import { normalQuantile } from "@mark1russell7/rigor-statistics";
import { describe, expect, it } from "vitest";
import { HISTOGRAM_BOUNDARIES } from "../../adapters/lag-core";
import { formatMs } from "../../lib/format";
import { aggregate, aggregateSamples, bucketCounts, histogramQuantile, samplesOf, type BrowserLoad } from "./histogram-model";

const DURATION = HISTOGRAM_BOUNDARIES.duration;

describe("normalQuantile", () => {
    it("gives the known values of the standard normal distribution", () => {
        expect(normalQuantile(0.5)).toBeCloseTo(0, 9);
        expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
        expect(normalQuantile(0.01)).toBeCloseTo(-2.326348, 5);
        expect(normalQuantile(0.3)).toBeCloseTo(-normalQuantile(0.7), 9);
        expect(normalQuantile(0)).toBe(-Infinity);
        expect(normalQuantile(1)).toBe(Infinity);
    });
});

/**
 * The copy of the site before the move to rigor-statistics, word for word. It is
 * the quantile function of the standard normal distribution, with the rational
 * approximation of Peter Acklam (relative error below 1.2e-9).
 */
function copyNormalQuantile(p : number) : number {
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
    if (p > 1 - low) return -copyNormalQuantile(1 - p);
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q
        / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

describe("normalQuantile of rigor-statistics and the copy of the site", () => {
    it("differ by less than the error of the copy, 1.2e-9 relative", () => {
        const ps : number[] = [1e-12, 1e-9, 1e-6, 1e-3, 0.02425, 0.3, 0.5, 0.7, 0.97575, 0.999, 1 - 1e-6, 1 - 1e-9];
        for (let index = 0; index < 1000; index++) ps.push((index + 0.5) / 1000);
        for (const p of ps) {
            const home = normalQuantile(p);
            const copy = copyNormalQuantile(p);
            expect(Math.abs(home - copy)).toBeLessThanOrEqual(1.2e-9 * Math.abs(home) + 1e-15);
        }
        expect(copyNormalQuantile(0)).toBe(normalQuantile(0));
        expect(copyNormalQuantile(1)).toBe(normalQuantile(1));
    });

    it("give the same text of the explainer for each load of a sweep", () => {
        const copySamples = (load : BrowserLoad) : number[] => {
            const count = Math.max(0, Math.round(load.samples));
            return Array.from({ length : count }, (_, index) => load.medianMs * Math.exp(load.spread * copyNormalQuantile((index + 0.5) / count)));
        };
        const text = (load : readonly BrowserLoad[], samplesOfLoad : (load : BrowserLoad) => number[]) => {
            const result = aggregateSamples(load.map(one => ({ name : one.name, values : samplesOfLoad(one) })), DURATION);
            const ms = (value : number | undefined) : string => (value === undefined ? "–" : formatMs(value));
            return {
                p95 : result.browsers.map(browser => ms(browser.p95)),
                pooled : ms(result.pooled),
                fromHistogram : ms(result.fromHistogram),
                meanOfPercentiles : ms(result.meanOfPercentiles),
                buckets : result.buckets,
            };
        };
        let cases = 0;
        for (const samples of [1, 2, 10, 300, 1_500, 4_000]) {
            for (const medianMs of [1, 5, 20, 45, 160, 1_000]) {
                for (const spread of [0.1, 0.55, 1.5]) {
                    const loads : BrowserLoad[] = [
                        { name : "Desktop computers", samples : 4_000, medianMs : 20, spread : 0.55 },
                        { name : "Laptops", samples : 1_500, medianMs : 45, spread : 0.55 },
                        { name : "Phones", samples, medianMs, spread },
                    ];
                    expect(text(loads, samplesOf)).toEqual(text(loads, copySamples));
                    cases++;
                }
            }
        }
        expect(cases).toBe(108);
    });
});

describe("samplesOf", () => {
    it("gives the number of samples, with the median in the middle", () => {
        const values = samplesOf({ name : "A", samples : 101, medianMs : 40, spread : 0.5 });
        expect(values).toHaveLength(101);
        expect(values[50]).toBeCloseTo(40, 9);
        expect([...values].sort((a, b) => a - b)).toEqual(values);
    });

    it("gives the same samples for the same load", () => {
        const load = { name : "A", samples : 300, medianMs : 25, spread : 0.6 };
        expect(samplesOf(load)).toEqual(samplesOf(load));
    });
});

describe("bucketCounts", () => {
    it("puts a value at a boundary into the bucket of that boundary, as OpenTelemetry does", () => {
        expect(bucketCounts([0.5, 1, 1.5, 2, 3, 10], [1, 2, 5])).toEqual([2, 2, 1, 1]);
    });
});

describe("histogramQuantile", () => {
    it("interpolates in the bucket of the rank, from 0 in the lowest bucket", () => {
        expect(histogramQuantile(0.5, [10, 20], [5, 5, 0])).toBe(10);
        expect(histogramQuantile(0.75, [10, 20], [5, 5, 0])).toBe(15);
        expect(histogramQuantile(0.2, [10, 20], [5, 5, 0])).toBe(4);
    });

    it("gives the last boundary for a rank in the last bucket, and nothing without samples", () => {
        expect(histogramQuantile(0.95, [10, 20], [1, 1, 8])).toBe(20);
        expect(histogramQuantile(0.95, [10, 20], [0, 0, 0])).toBeUndefined();
    });
});

describe("aggregateSamples", () => {
    it("gives the example of the metrics-model page: a mean of 255 ms, but 500 ms for all samples", () => {
        const pageA = { name : "A", values : new Array<number>(100).fill(10) };
        const pageB = { name : "B", values : [...new Array<number>(85).fill(10), ...new Array<number>(15).fill(500)] };
        const result = aggregateSamples([pageA, pageB], DURATION);
        expect(result.browsers.map(browser => browser.p95)).toEqual([10, 500]);
        expect(result.meanOfPercentiles).toBe(255);
        expect(result.pooled).toBe(500);
        // The rank 190 is the 5th of the 15 values in the bucket from 300 ms to 500 ms
        expect(result.fromHistogram).toBeCloseTo(300 + 200 * (5 / 15), 9);
        expect(result.buckets).toEqual([
            { lower : 5, upper : 10, counts : [100, 85] },
            { lower : 300, upper : 500, counts : [0, 15] },
        ]);
    });
});

describe("aggregate", () => {
    it("keeps the histogram estimate in the bucket of the correct value, while the mean of the percentiles is far from it", () => {
        const result = aggregate([
            { name : "Desktop", samples : 4000, medianMs : 20, spread : 0.55 },
            { name : "Laptop", samples : 1500, medianMs : 45, spread : 0.55 },
            { name : "Phone", samples : 300, medianMs : 160, spread : 0.55 },
        ], DURATION);
        const pooled = result.pooled!;
        const upper = DURATION.find(boundary => boundary >= pooled)!;
        const lower = DURATION[DURATION.indexOf(upper) - 1]!;
        expect(result.fromHistogram).toBeGreaterThanOrEqual(lower);
        expect(result.fromHistogram).toBeLessThanOrEqual(upper);
        expect(Math.abs(result.meanOfPercentiles! - pooled)).toBeGreaterThan(upper - lower);
    });
});
