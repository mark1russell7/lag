import { describe, expect, it } from "vitest";
import { HISTOGRAM_BOUNDARIES } from "../../adapters/lag-core";
import { aggregate, aggregateSamples, bucketCounts, histogramQuantile, normalQuantile, samplesOf } from "./histogram-model";

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
