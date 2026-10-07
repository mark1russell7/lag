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

    it("asks the browser for events down to 16ms (default threshold is 104ms)", () => {
        const observe = vi.fn();
        class SpyObserver {
            constructor(_callback : unknown) {}
            observe = observe;
            disconnect() {}
        }

        new EventTimingMonitor(vi.fn(), { log : vi.fn() }, SpyObserver as unknown as PerformanceObserverInit);

        expect(observe).toHaveBeenCalledWith({ type : "event", buffered : true, durationThreshold : 16 });
    });

    it("keeps INP correct while tracking only the longest few interactions", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const monitor = new EventTimingMonitor(vi.fn(), { log : vi.fn() }, MockCtor);

        // 1000 interactions with durations 1..1000, in shuffled order
        const durations = Array.from({ length : 1000 }, (_, i) => i + 1);
        for (let i = durations.length - 1; i > 0; i--) {
            const j = (i * 7919) % (i + 1);
            [durations[i], durations[j]] = [durations[j]!, durations[i]!];
        }
        triggerEntries(durations.map((duration, i) => makeEventEntry({ interactionId : i + 1, duration })));

        // floor(1000 / 50) = 20 outliers ignored — but only 10 are tracked, so
        // the 10th longest is the best available answer (as in web-vitals)
        expect(monitor.getINP()).toBe(991);
        expect(monitor.getWorstInteractionDuration()).toBe(1000);
    });

    it("counts an interaction once across its several events", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const monitor = new EventTimingMonitor(vi.fn(), { log : vi.fn() }, MockCtor);

        // 50 interactions, each with pointerdown + pointerup + click
        const entries = Array.from({ length : 50 }, (_, i) => ["pointerdown", "pointerup", "click"].map(name =>
            makeEventEntry({ interactionId : i + 1, name, duration : name === "click" ? (i + 1) * 10 : 8 }),
        )).flat();
        triggerEntries(entries);

        // 50 interactions → one outlier ignored → second longest click
        expect(monitor.getINP()).toBe(490);
    });

    it("clamps presentationDelay at 0 when rounding makes it negative", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        new EventTimingMonitor(report, { log : vi.fn() }, MockCtor);

        // duration is rounded to 8ms: 72 < processingEnd - startTime = 75
        triggerEntries([makeEventEntry({ startTime : 100, processingStart : 110, processingEnd : 175, duration : 72 })]);

        expect(report.mock.calls[0]![0].presentationDelay).toBe(0);
    });

    it("uses performance.interactionCount when the browser supplies it", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        let browserCount = 0;
        const monitor = new EventTimingMonitor(vi.fn(), { log : vi.fn() }, MockCtor, () => browserCount);

        // 200 interactions happened; only the 10 slowest produced entries
        browserCount = 200;
        triggerEntries(Array.from({ length : 10 }, (_, i) => makeEventEntry({ interactionId : (i + 1) * 7, duration : 300 - i })));

        expect(monitor.getInteractionCount()).toBe(200);
        // 200 interactions: skip 4 outliers, so the 5th longest
        expect(monitor.getINP()).toBe(296);
    });

    it("counts the interactions it saw when the browser count is missing", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const monitor = new EventTimingMonitor(vi.fn(), { log : vi.fn() }, MockCtor, () => undefined);

        triggerEntries(Array.from({ length : 10 }, (_, i) => makeEventEntry({ interactionId : (i + 1) * 7, duration : 300 - i })));

        expect(monitor.getInteractionCount()).toBe(10);
        expect(monitor.getINP()).toBe(300);
    });
});
