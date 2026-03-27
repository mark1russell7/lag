import { vi, expect } from "vitest";
import { LayoutShiftMonitor } from "./LayoutShiftMonitor.js";
import type { PerformanceEntryList, PerformanceObserverInit, LayoutShiftEntry } from "./perf-types.js";

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
        triggerEntries(entries : LayoutShiftEntry[]) {
            capturedCallback?.({ getEntries : () => entries });
        },
    };
}

function makeShiftEntry(overrides : Partial<LayoutShiftEntry> = {}) : LayoutShiftEntry {
    return {
        entryType : "layout-shift",
        name : "",
        startTime : 1000,
        duration : 0,
        value : 0.1,
        hadRecentInput : false,
        lastInputTime : 0,
        sources : [],
        ...overrides,
    };
}

describe("LayoutShiftMonitor", () => {
    it("reports individual shift values", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new LayoutShiftMonitor(report, logger, MockCtor);

        triggerEntries([makeShiftEntry({ value : 0.15 })]);

        expect(report).toHaveBeenCalledWith(expect.objectContaining({
            value : 0.15,
        }));
    });

    it("excludes shifts with hadRecentInput=true", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new LayoutShiftMonitor(report, logger, MockCtor);

        triggerEntries([makeShiftEntry({ hadRecentInput : true })]);

        expect(report).not.toHaveBeenCalled();
    });

    it("accumulates session values within 1s gap", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new LayoutShiftMonitor(report, logger, MockCtor);

        triggerEntries([
            makeShiftEntry({ startTime : 1000, value : 0.1 }),
            makeShiftEntry({ startTime : 1500, value : 0.2 }),  // 500ms gap, same session
        ]);

        expect(report).toHaveBeenCalledTimes(2);
        expect(report.mock.calls[1]![0].sessionValue).toBeCloseTo(0.3);
    });

    it("starts new session after 1s gap", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new LayoutShiftMonitor(report, logger, MockCtor);

        triggerEntries([
            makeShiftEntry({ startTime : 1000, value : 0.1 }),
        ]);
        triggerEntries([
            makeShiftEntry({ startTime : 2500, value : 0.05 }),  // 1500ms gap, new session
        ]);

        expect(report.mock.calls[1]![0].sessionValue).toBeCloseTo(0.05);
    });

    it("starts new session after 5s max duration", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new LayoutShiftMonitor(report, logger, MockCtor);

        // Build up a session over 5s
        triggerEntries([makeShiftEntry({ startTime : 1000, value : 0.1 })]);
        triggerEntries([makeShiftEntry({ startTime : 1800, value : 0.1 })]);
        triggerEntries([makeShiftEntry({ startTime : 2600, value : 0.1 })]);
        triggerEntries([makeShiftEntry({ startTime : 3400, value : 0.1 })]);
        triggerEntries([makeShiftEntry({ startTime : 4200, value : 0.1 })]);
        triggerEntries([makeShiftEntry({ startTime : 5000, value : 0.1 })]);
        // 6100 - 1000 = 5100 > 5000, new session
        triggerEntries([makeShiftEntry({ startTime : 6100, value : 0.05 })]);

        const lastCall = report.mock.calls[report.mock.calls.length - 1]![0];
        expect(lastCall.sessionValue).toBeCloseTo(0.05);
    });

    it("tracks worst session value as CLS", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        const monitor = new LayoutShiftMonitor(report, logger, MockCtor);

        // Session 1: total 0.3
        triggerEntries([
            makeShiftEntry({ startTime : 1000, value : 0.1 }),
            makeShiftEntry({ startTime : 1500, value : 0.2 }),
        ]);

        // Session 2 (after 1s gap): total 0.05
        triggerEntries([
            makeShiftEntry({ startTime : 3000, value : 0.05 }),
        ]);

        expect(monitor.getCLS()).toBeCloseTo(0.3);
    });

    it("resets on stop", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const logger = { log : vi.fn() };

        const monitor = new LayoutShiftMonitor(vi.fn(), logger, MockCtor);

        triggerEntries([makeShiftEntry({ startTime : 1000, value : 0.5 })]);
        expect(monitor.getCLS()).toBeCloseTo(0.5);

        monitor.stop();
        expect(monitor.getCLS()).toBe(0);
    });
});
