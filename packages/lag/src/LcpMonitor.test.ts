import { vi, expect } from "vitest";
import { LcpMonitor } from "./LcpMonitor.js";
import type { PerformanceEntryList, PerformanceObserverInit, LcpEntry } from "./perf-types.js";

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
        triggerEntries(entries : LcpEntry[]) {
            capturedCallback?.({ getEntries : () => entries });
        },
    };
}

function makeLcpEntry(overrides : Partial<LcpEntry> = {}) : LcpEntry {
    return {
        entryType : "largest-contentful-paint",
        name : "",
        startTime : 0,
        duration : 0,
        renderTime : 1000,
        loadTime : 1100,
        size : 5000,
        id : "hero-image",
        url : "https://example.com/hero.jpg",
        element : null,
        ...overrides,
    };
}

describe("LcpMonitor", () => {
    it("reports an LCP entry on first observation", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const monitor = new LcpMonitor(report, { log : vi.fn() }, MockCtor);

        triggerEntries([makeLcpEntry({ renderTime : 1500 })]);

        expect(report).toHaveBeenCalledWith(expect.objectContaining({
            renderTime : 1500,
        }));
        expect(monitor.getLCP()).toBe(1500);
    });

    it("updates LCP when a larger entry is observed", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const monitor = new LcpMonitor(report, { log : vi.fn() }, MockCtor);

        triggerEntries([makeLcpEntry({ renderTime : 1000 })]);
        triggerEntries([makeLcpEntry({ renderTime : 2000 })]);

        expect(report).toHaveBeenCalledTimes(2);
        expect(monitor.getLCP()).toBe(2000);
    });

    it("does not update LCP when a smaller entry is observed", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const monitor = new LcpMonitor(report, { log : vi.fn() }, MockCtor);

        triggerEntries([makeLcpEntry({ renderTime : 2000 })]);
        triggerEntries([makeLcpEntry({ renderTime : 1500 })]);

        expect(report).toHaveBeenCalledTimes(1);
        expect(monitor.getLCP()).toBe(2000);
    });

    it("falls back to loadTime when renderTime is 0 (cross-origin without TAO)", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const monitor = new LcpMonitor(vi.fn(), { log : vi.fn() }, MockCtor);

        triggerEntries([makeLcpEntry({ renderTime : 0, loadTime : 800 })]);

        expect(monitor.getLCP()).toBe(800);
    });

    it("returns 0 LCP before any entries", () => {
        const { MockCtor } = createMockPerformanceObserver();
        const monitor = new LcpMonitor(vi.fn(), { log : vi.fn() }, MockCtor);

        expect(monitor.getLCP()).toBe(0);
        expect(monitor.getLatestEntry()).toBeUndefined();
    });
});
