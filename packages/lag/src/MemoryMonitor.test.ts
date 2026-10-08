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

    it("drops a modern sample that resolves after stop()", async () => {
        const reports : MemoryMeasurement[] = [];
        let resolveModern : (r : { bytes : number; breakdown : [] }) => void = () => {};
        const monitor = new MemoryMonitor(
            10_000,
            { measureModern : () => new Promise(r => { resolveModern = r; }) },
            (m) => reports.push(m),
            { log : vi.fn() },
            vi.fn() as never,
            vi.fn(),
            { now : () => 0 },
        );

        monitor.stop();
        resolveModern({ bytes : 1, breakdown : [] });
        for (let i = 0; i < 5; i++) await Promise.resolve();

        expect(reports).toHaveLength(0);
    });

    it("does not start a new sample while one is still pending", () => {
        let intervalCallback = () => {};
        const measureModern = vi.fn(() => new Promise<never>(() => {}));
        new MemoryMonitor(
            1_000,
            { measureModern },
            vi.fn(),
            { log : vi.fn() },
            ((cb : () => void) => { intervalCallback = cb; return 1; }) as never,
            vi.fn(),
            { now : () => 0 },
        );

        intervalCallback();
        intervalCallback();

        expect(measureModern).toHaveBeenCalledTimes(1);
    });

    it("stops calling the modern API after it fails once", async () => {
        let intervalCallback = () => {};
        const measureModern = vi.fn(() => Promise.reject(new Error("SecurityError")));
        const reports : MemoryMeasurement[] = [];
        new MemoryMonitor(
            1_000,
            {
                measureModern,
                readLegacy : () => ({ usedJSHeapSize : 1, totalJSHeapSize : 2, jsHeapSizeLimit : 100 }),
            },
            (m) => reports.push(m),
            { log : vi.fn() },
            ((cb : () => void) => { intervalCallback = cb; return 1; }) as never,
            vi.fn(),
            { now : () => 0 },
        );
        await vi.waitFor(() => expect(reports).toHaveLength(1));

        intervalCallback();
        await vi.waitFor(() => expect(reports).toHaveLength(2));

        expect(measureModern).toHaveBeenCalledTimes(1);
        expect(reports.map(r => r.source)).toEqual(["legacy", "legacy"]);
    });

    describe("rules of the sources", () => {
        function createMonitor(source : MemorySource, report : (m : MemoryMeasurement) => void = () => {}) {
            const logger = { log : vi.fn() };
            const setIntervalFn = vi.fn((fn : () => void, ms : number) => setInterval(fn, ms) as unknown as number);
            const monitor = new MemoryMonitor(1_000, source, report, logger, setIntervalFn, (id) => clearInterval(id), { now : () => 0 });
            return { monitor, logger, setIntervalFn };
        }

        it("start() while the monitor operates adds no second interval", () => {
            const m = createMonitor({ readLegacy : () => ({ usedJSHeapSize : 1, totalJSHeapSize : 2, jsHeapSizeLimit : 3 }) });

            m.monitor.start();
            m.monitor.stop();

            expect(m.setIntervalFn).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        });

        it("logs an error from the report function and continues with the next sample", async () => {
            const report = vi.fn<(m : MemoryMeasurement) => void>();
            report.mockImplementationOnce(() => { throw new Error("export failed"); });
            const m = createMonitor({ readLegacy : () => ({ usedJSHeapSize : 1, totalJSHeapSize : 2, jsHeapSizeLimit : 3 }) }, report);
            await vi.advanceTimersByTimeAsync(1_000);
            m.monitor.stop();

            expect(m.logger.log).toHaveBeenCalledWith("error", "Error in memory measurement.", { error : expect.any(Error), type : "MemoryMonitor" });
            expect(report).toHaveBeenCalledTimes(2);
        });

        it("logs the failure of the standard API at debug level, and reports nothing without a legacy API", async () => {
            const report = vi.fn();
            const m = createMonitor({ measureModern : () => Promise.reject(new Error("not isolated")) }, report);
            await vi.advanceTimersByTimeAsync(0);
            m.monitor.stop();

            expect(m.logger.log.mock.calls).toEqual([["debug", "measureUserAgentSpecificMemory failed; using legacy performance.memory from now on.", { error : expect.any(Error), type : "MemoryMonitor" }]]);
            expect(report).not.toHaveBeenCalled();
        });

        it("reports nothing, and logs nothing, when the legacy API gives no value", async () => {
            const report = vi.fn();
            const m = createMonitor({ readLegacy : () => undefined }, report);
            await vi.advanceTimersByTimeAsync(0);
            m.monitor.stop();

            expect(report).not.toHaveBeenCalled();
            expect(m.logger.log).not.toHaveBeenCalled();
        });

        it("gives no usage for a heap limit of 0", async () => {
            const report = vi.fn();
            const m = createMonitor({ readLegacy : () => ({ usedJSHeapSize : 10, totalJSHeapSize : 20, jsHeapSizeLimit : 0 }) }, report);
            await vi.advanceTimersByTimeAsync(0);
            m.monitor.stop();

            expect(report).toHaveBeenCalledWith(expect.objectContaining({ usedBytes : 10, usagePercent : undefined }));
        });
    });
});
