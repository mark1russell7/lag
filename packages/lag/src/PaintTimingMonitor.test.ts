import { vi, expect } from "vitest";
import { PaintTimingMonitor } from "./PaintTimingMonitor.js";
import type { PerformanceEntryList, PerformanceObserverInit, PaintEntry } from "./perf-types.js";

function createMockPerformanceObserver() {
    let capturedCallback : ((list : PerformanceEntryList) => void) | undefined;

    class MockPerformanceObserver {
        constructor(callback : (list : PerformanceEntryList) => void) {
            capturedCallback = callback;
        }
        observe() {}
        disconnect() {}
    }

    return {
        MockCtor : MockPerformanceObserver as unknown as PerformanceObserverInit,
        triggerEntries(entries : PaintEntry[]) {
            capturedCallback?.({ getEntries : () => entries });
        },
    };
}

describe("PaintTimingMonitor", () => {
    it("reports first-paint and tracks it", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const monitor = new PaintTimingMonitor(report, { log : vi.fn() }, MockCtor);

        triggerEntries([{
            entryType : "paint",
            name : "first-paint",
            startTime : 123,
            duration : 0,
        }]);

        expect(report).toHaveBeenCalledWith({ name : "first-paint", startTime : 123 });
        expect(monitor.getFirstPaint()).toBe(123);
    });

    it("reports first-contentful-paint and tracks it", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const monitor = new PaintTimingMonitor(report, { log : vi.fn() }, MockCtor);

        triggerEntries([{
            entryType : "paint",
            name : "first-contentful-paint",
            startTime : 456,
            duration : 0,
        }]);

        expect(report).toHaveBeenCalledWith({ name : "first-contentful-paint", startTime : 456 });
        expect(monitor.getFirstContentfulPaint()).toBe(456);
    });

    it("processes both paint events independently", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const monitor = new PaintTimingMonitor(vi.fn(), { log : vi.fn() }, MockCtor);

        triggerEntries([
            { entryType : "paint", name : "first-paint", startTime : 100, duration : 0 },
            { entryType : "paint", name : "first-contentful-paint", startTime : 150, duration : 0 },
        ]);

        expect(monitor.getFirstPaint()).toBe(100);
        expect(monitor.getFirstContentfulPaint()).toBe(150);
    });

    it("returns -1 before any paint event fires", () => {
        const { MockCtor } = createMockPerformanceObserver();
        const monitor = new PaintTimingMonitor(vi.fn(), { log : vi.fn() }, MockCtor);

        expect(monitor.getFirstPaint()).toBe(-1);
        expect(monitor.getFirstContentfulPaint()).toBe(-1);
    });
});
