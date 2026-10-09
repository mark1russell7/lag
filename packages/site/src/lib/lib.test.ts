import { describe, expect, it, vi } from "vitest";
import { formatBytes, formatCount, formatDate, formatDateTime, formatMs, formatPercent, formatValue, shortCommit } from "./format";
import { memoizePromise, memoizePromiseByKey } from "./memoize-promise";
import { downsampleMax, ecdf, percentile, sortedValues, summarize, symlogBins } from "./stats";

describe("format", () => {
    it("formats durations", () => {
        expect(formatMs(0.123)).toBe("0.12 ms");
        expect(formatMs(3.46)).toBe("3.5 ms");
        expect(formatMs(120.4)).toBe("120 ms");
        expect(formatMs(1_250)).toBe("1.25 s");
        expect(formatMs(125_000)).toBe("2 min 5 s");
        expect(formatMs(Number.NaN)).toBe("–");
    });

    it("rounds a duration of minutes to whole seconds before it divides them", () => {
        expect(formatMs(119_600)).toBe("2 min 0 s");
        expect(formatMs(59_400)).toBe("59.4 s");
        expect(formatMs(59_996)).toBe("1 min 0 s");
        expect(formatMs(-119_600)).toBe("-2 min 0 s");
    });

    it("shows 100% and 0% only for exactly 100 and 0", () => {
        expect(formatPercent(99.96)).toBe("99.9%");
        expect(formatPercent(99.94)).toBe("99.9%");
        expect(formatPercent(0.04)).toBe("0.1%");
        expect(formatPercent(0)).toBe("0%");
        expect(formatPercent(100)).toBe("100%");
    });

    it("formats percentages, bytes, units and counts", () => {
        expect(formatPercent(87.54)).toBe("87.5%");
        expect(formatPercent(100)).toBe("100%");
        expect(formatPercent(undefined)).toBe("No data");
        expect(formatBytes(1536)).toBe("1.5 KB");
        expect(formatValue(0.25, "ratio")).toBe("25%");
        expect(formatValue(3, "{gc}")).toBe("3 gc");
        expect(formatCount(1, "test")).toBe("1 test");
        expect(formatCount(1200, "test")).toBe("1,200 tests");
        expect(shortCommit("f6e5d4c3b2a1")).toBe("f6e5d4c");
    });

    it("formats dates in UTC", () => {
        expect(formatDateTime("2026-10-06T09:41:33.000Z")).toBe("6 Oct 2026, 09:41 UTC");
        expect(formatDate("2026-10-06T23:59:00.000Z")).toBe("6 Oct 2026");
        expect(formatDate("soon")).toBe("soon");
    });
});

describe("stats", () => {
    it("uses the nearest-rank percentile", () => {
        const sorted = sortedValues([5, 1, 4, 2, 3, Number.NaN]);
        expect(sorted).toEqual([1, 2, 3, 4, 5]);
        expect(percentile(sorted, 50)).toBe(3);
        expect(percentile(sorted, 95)).toBe(5);
        expect(percentile(sorted, 0)).toBe(1);
        expect(percentile([], 50)).toBeUndefined();
    });

    it("summarizes values", () => {
        const values = Array.from({ length : 100 }, (_, index) => index + 1);
        expect(summarize(values)).toEqual({ count : 100, min : 1, max : 100, mean : 50.5, p50 : 50, p95 : 95, p99 : 99 });
        expect(summarize([]).count).toBe(0);
    });

    it("makes an ECDF and limits its points", () => {
        expect(ecdf([3, 1, 2])).toEqual([{ value : 1, fraction : 1 / 3 }, { value : 2, fraction : 2 / 3 }, { value : 3, fraction : 1 }]);
        const many = ecdf(Array.from({ length : 10_000 }, (_, index) => index), 100);
        expect(many).toHaveLength(101);
        expect(many.at(-1)).toEqual({ value : 9_999, fraction : 1 });
    });

    it("bins values on a log(1 + x) scale", () => {
        const values = [0, 0, 1, 10, 100, 1_000];
        const bins = symlogBins(values, 6);
        expect(bins).toHaveLength(6);
        expect(bins[0]?.x0).toBe(0);
        expect(bins.at(-1)?.x1).toBe(1_000);
        expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(values.length);
        expect(symlogBins([7, 7])).toEqual([{ x0 : 7, x1 : 8, count : 2 }]);
        expect(symlogBins([])).toEqual([]);
    });

    it("gives one bin when the values differ but have the same log(1 + x)", () => {
        // The difference of two performance.now() readings: 999.9999999999999 and 1000
        const values = [1000, 1500.1 - 500.1, 1000];
        expect(Math.log1p(values[1]!)).toBe(Math.log1p(1000));
        expect(symlogBins(values, 28)).toEqual([{ x0 : 1500.1 - 500.1, x1 : 1500.1 - 500.1 + 1, count : 3 }]);
    });

    it("puts each value into a bin, also the maximum, and gives at least one bin", () => {
        const values = [0.5, 3, 3, 40, 2_000];
        const bins = symlogBins(values, 5);
        expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(values.length);
        expect(bins.at(-1)!.count).toBeGreaterThan(0);
        expect(symlogBins([1, 2], 0)).toEqual([{ x0 : 1, x1 : 2, count : 2 }]);
    });

    it("keeps spikes when it reduces a series", () => {
        const points = Array.from({ length : 100 }, (_, t) => ({ t, value : t === 42 ? 900 : 1 }));
        const reduced = downsampleMax(points, 10);
        expect(reduced).toHaveLength(10);
        expect(reduced.some(point => point.value === 900)).toBe(true);
        expect(downsampleMax(points.slice(0, 5), 10)).toHaveLength(5);
    });
});

describe("memoizePromise", () => {
    it("returns the same promise and tries again after a rejection", async () => {
        const load = vi.fn()
            .mockRejectedValueOnce(new Error("first"))
            .mockResolvedValue("ok");
        const memo = memoizePromise(load);
        await expect(memo()).rejects.toThrow("first");
        const second = memo();
        expect(memo()).toBe(second);
        await expect(second).resolves.toBe("ok");
        expect(load).toHaveBeenCalledTimes(2);
    });

    it("keeps one entry for each key", async () => {
        const load = vi.fn((key : string) => Promise.resolve(key.toUpperCase()));
        const memo = memoizePromiseByKey(load);
        await expect(memo("a")).resolves.toBe("A");
        await memo("a");
        await memo("b");
        expect(load).toHaveBeenCalledTimes(2);
    });
});
