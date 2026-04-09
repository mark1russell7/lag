import { vi, expect } from "vitest";
import { MemoryMonitor, type MemoryMeasurement, type MemorySource } from "./MemoryMonitor.js";

describe("MemoryMonitor", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("samples legacy memory immediately on start", async () => {
        const reports : MemoryMeasurement[] = [];
        const source : MemorySource = {
            readLegacy : () => ({
                usedJSHeapSize : 50_000_000,
                totalJSHeapSize : 100_000_000,
                jsHeapSizeLimit : 2_000_000_000,
            }),
        };

        new MemoryMonitor(
            10_000,
            source,
            (m) => reports.push(m),
            { log : vi.fn() },
            vi.fn() as never,
            vi.fn(),
            { now : () => 1234 },
        );

        await Promise.resolve();

        expect(reports).toHaveLength(1);
        expect(reports[0]!.source).toBe("legacy");
        expect(reports[0]!.usedBytes).toBe(50_000_000);
        expect(reports[0]!.totalBytes).toBe(100_000_000);
        expect(reports[0]!.limitBytes).toBe(2_000_000_000);
        expect(reports[0]!.usagePercent).toBeCloseTo(2.5);
        expect(reports[0]!.timestamp).toBe(1234);
    });

    it("uses modern API when available and ignores legacy", async () => {
        const reports : MemoryMeasurement[] = [];
        const source : MemorySource = {
            measureModern : vi.fn(async () => ({
                bytes : 75_000_000,
                breakdown : [],
            })),
            readLegacy : vi.fn(),
        };

        new MemoryMonitor(
            10_000,
            source,
            (m) => reports.push(m),
            { log : vi.fn() },
            vi.fn() as never,
            vi.fn(),
            { now : () => 0 },
        );

        // Wait for the async sample to settle
        await vi.waitFor(() => expect(reports).toHaveLength(1));

        expect(reports[0]!.source).toBe("modern");
        expect(reports[0]!.usedBytes).toBe(75_000_000);
        expect(source.readLegacy).not.toHaveBeenCalled();
    });

    it("falls back to legacy when modern API rejects", async () => {
        const reports : MemoryMeasurement[] = [];
        const source : MemorySource = {
            measureModern : vi.fn(() => Promise.reject(new Error("not allowed"))),
            readLegacy : () => ({
                usedJSHeapSize : 10,
                totalJSHeapSize : 20,
                jsHeapSizeLimit : 100,
            }),
        };

        new MemoryMonitor(
            10_000,
            source,
            (m) => reports.push(m),
            { log : vi.fn() },
            vi.fn() as never,
            vi.fn(),
            { now : () => 0 },
        );

        await vi.waitFor(() => expect(reports).toHaveLength(1));

        expect(reports[0]!.source).toBe("legacy");
        expect(reports[0]!.usedBytes).toBe(10);
    });

    it("schedules periodic samples on the configured interval", () => {
        const setIntervalSpy = vi.fn();
        const source : MemorySource = {
            readLegacy : () => ({
                usedJSHeapSize : 1, totalJSHeapSize : 2, jsHeapSizeLimit : 100,
            }),
        };

        new MemoryMonitor(
            5_000,
            source,
            vi.fn(),
            { log : vi.fn() },
            setIntervalSpy as never,
            vi.fn(),
            { now : () => 0 },
        );

        expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5_000);
    });

    it("handles missing source methods gracefully", async () => {
        const reports : MemoryMeasurement[] = [];

        new MemoryMonitor(
            10_000,
            {}, // empty source
            (m) => reports.push(m),
            { log : vi.fn() },
            vi.fn() as never,
            vi.fn(),
            { now : () => 0 },
        );

        await Promise.resolve();
        expect(reports).toHaveLength(0);
    });

    it("clears the interval on stop", () => {
        const clearIntervalSpy = vi.fn();
        const monitor = new MemoryMonitor(
            10_000,
            { readLegacy : () => ({
                usedJSHeapSize : 1, totalJSHeapSize : 2, jsHeapSizeLimit : 100,
            }) },
            vi.fn(),
            { log : vi.fn() },
            vi.fn(() => 99) as never,
            clearIntervalSpy,
            { now : () => 0 },
        );

        monitor.stop();
        expect(clearIntervalSpy).toHaveBeenCalledWith(99);
    });
});
