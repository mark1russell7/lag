import { vi, expect } from "vitest";
import { LongAnimationFrameMonitor } from "./LongAnimationFrameMonitor.js";
import type { PerformanceEntryList, PerformanceObserverInit, LoafEntry } from "./perf-types.js";

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
        triggerEntries(entries : LoafEntry[]) {
            capturedCallback?.({ getEntries : () => entries });
        },
    };
}

function makeLoafEntry(overrides : Partial<LoafEntry> = {}) : LoafEntry {
    return {
        entryType : "long-animation-frame",
        name : "",
        startTime : 100,
        duration : 200,
        blockingDuration : 150,
        renderStart : 150,
        styleAndLayoutStart : 180,
        scripts : [],
        ...overrides,
    };
}

describe("LongAnimationFrameMonitor", () => {
    it("reports blockingDuration and duration from LoAF entries", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new LongAnimationFrameMonitor(report, logger, MockCtor);

        triggerEntries([makeLoafEntry({ blockingDuration : 120, duration : 250 })]);

        expect(report).toHaveBeenCalledTimes(1);
        expect(report).toHaveBeenCalledWith(expect.objectContaining({
            blockingDuration : 120,
            duration : 250,
        }));
    });

    it("calculates renderDuration from renderStart to the end of the frame", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new LongAnimationFrameMonitor(report, logger, MockCtor);

        // Frame ends at 100 + 200 = 300; rendering started at 220
        triggerEntries([makeLoafEntry({
            startTime : 100,
            duration : 200,
            renderStart : 220,
            styleAndLayoutStart : 250,
        })]);

        expect(report.mock.calls[0]![0].renderDuration).toBe(80);
    });

    it("reports renderDuration 0 for frames that did not render", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new LongAnimationFrameMonitor(report, logger, MockCtor);

        // Browsers report renderStart = styleAndLayoutStart = 0 when nothing rendered
        triggerEntries([makeLoafEntry({
            startTime : 5_000,
            duration : 120,
            renderStart : 0,
            styleAndLayoutStart : 0,
        })]);

        expect(report.mock.calls[0]![0].renderDuration).toBe(0);
    });

    it("detects forced layout from scripts", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new LongAnimationFrameMonitor(report, logger, MockCtor);

        triggerEntries([makeLoafEntry({
            scripts : [
                {
                    name : "script",
                    invoker : "onclick",
                    invokerType : "event-listener",
                    startTime : 100,
                    executionStart : 100,
                    duration : 50,
                    forcedStyleAndLayoutDuration : 10,
                    sourceURL : "app.js",
                },
            ],
        })]);

        expect(report.mock.calls[0]![0].hasForceLayout).toBe(true);
        expect(report.mock.calls[0]![0].scriptCount).toBe(1);
    });

    it("reports hasForceLayout=false when no forced layout", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new LongAnimationFrameMonitor(report, logger, MockCtor);

        triggerEntries([makeLoafEntry({
            scripts : [
                {
                    name : "script",
                    invoker : "onclick",
                    invokerType : "event-listener",
                    startTime : 100,
                    executionStart : 100,
                    duration : 50,
                    forcedStyleAndLayoutDuration : 0,
                    sourceURL : "app.js",
                },
            ],
        })]);

        expect(report.mock.calls[0]![0].hasForceLayout).toBe(false);
    });
});
