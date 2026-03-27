import { vi, expect } from "vitest";
import { EventTimingMonitor } from "./EventTimingMonitor.js";
import type { PerformanceEntryList, PerformanceObserverInit, EventTimingEntry } from "./perf-types.js";

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
        triggerEntries(entries : EventTimingEntry[]) {
            capturedCallback?.({ getEntries : () => entries });
        },
    };
}

function makeEventEntry(overrides : Partial<EventTimingEntry> = {}) : EventTimingEntry {
    return {
        entryType : "event",
        name : "pointerdown",
        startTime : 100,
        duration : 200,
        processingStart : 120,
        processingEnd : 180,
        interactionId : 1,
        cancelable : true,
        ...overrides,
    };
}

describe("EventTimingMonitor", () => {
    it("reports decomposed event timing", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new EventTimingMonitor(report, logger, MockCtor);

        // startTime=100, processingStart=120, processingEnd=180, duration=200
        // inputDelay = 120 - 100 = 20
        // processingDuration = 180 - 120 = 60
        // presentationDelay = 200 - (180 - 100) = 120
        triggerEntries([makeEventEntry()]);

        expect(report).toHaveBeenCalledWith(expect.objectContaining({
            duration : 200,
            inputDelay : 20,
            processingDuration : 60,
            presentationDelay : 120,
            interactionId : 1,
        }));
    });

    it("ignores events with interactionId=0", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new EventTimingMonitor(report, logger, MockCtor);

        triggerEntries([makeEventEntry({ interactionId : 0 })]);

        expect(report).not.toHaveBeenCalled();
    });

    it("calculates INP as p98 of interaction durations", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        const monitor = new EventTimingMonitor(report, logger, MockCtor);

        // Create 100 interactions with durations 1..100
        const entries = Array.from({ length : 100 }, (_, i) =>
            makeEventEntry({ interactionId : i + 1, duration : i + 1 }),
        );
        triggerEntries(entries);

        // p98 of 1..100: ceil(100 * 0.98) - 1 = 97 → durations[97] = 98
        expect(monitor.getINP()).toBe(98);
    });

    it("returns 0 INP with no interactions", () => {
        const { MockCtor } = createMockPerformanceObserver();
        const logger = { log : vi.fn() };

        const monitor = new EventTimingMonitor(vi.fn(), logger, MockCtor);

        expect(monitor.getINP()).toBe(0);
    });

    it("tracks worst interaction duration per interactionId", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        const monitor = new EventTimingMonitor(report, logger, MockCtor);

        // Same interactionId, two events with different durations
        triggerEntries([
            makeEventEntry({ interactionId : 5, duration : 50 }),
            makeEventEntry({ interactionId : 5, duration : 150 }),
        ]);

        expect(monitor.getWorstInteractionDuration()).toBe(150);
    });

    it("resets on stop", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const logger = { log : vi.fn() };

        const monitor = new EventTimingMonitor(vi.fn(), logger, MockCtor);

        triggerEntries([makeEventEntry({ interactionId : 1, duration : 300 })]);
        expect(monitor.getINP()).toBe(300);

        monitor.stop();
        expect(monitor.getINP()).toBe(0);
    });
});
