import { vi, expect } from "vitest";
import type { PerformanceEntryLike, PerformanceEntryList, PerformanceObserverInit } from "./perf-types.js";
import { ObserverMonitor } from "./ObserverMonitor.js";

class TestObserverMonitor extends ObserverMonitor {
    public entries : PerformanceEntryLike[] = [];

    protected processEntry(entry : PerformanceEntryLike) : void {
        this.entries.push(entry);
    }
}

function createMockPerformanceObserver() {
    let capturedCallback : ((list : PerformanceEntryList) => void) | undefined;

    const observeSpy = vi.fn();
    const disconnectSpy = vi.fn();
    let constructCount = 0;

    class MockPerformanceObserver {
        constructor(callback : (list : PerformanceEntryList) => void) {
            capturedCallback = callback;
            constructCount++;
        }
        observe = observeSpy;
        disconnect = disconnectSpy;
    }

    return {
        MockCtor : MockPerformanceObserver as unknown as PerformanceObserverInit,
        observeSpy,
        disconnectSpy,
        get constructCount() { return constructCount; },
        triggerEntries(entries : PerformanceEntryLike[]) {
            capturedCallback?.({ getEntries : () => entries });
        },
    };
}

describe("ObserverMonitor", () => {
    it("creates a PerformanceObserver and calls observe with buffered", () => {
        const { MockCtor, observeSpy } = createMockPerformanceObserver();
        const logger = { log : vi.fn() };

        new TestObserverMonitor("longtask", logger, MockCtor);

        expect(observeSpy).toHaveBeenCalledWith({
            type : "longtask",
            buffered : true,
        });
    });

    it("processes entries via processEntry", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const logger = { log : vi.fn() };

        const monitor = new TestObserverMonitor("longtask", logger, MockCtor);

        const entry = { entryType : "longtask", name : "self", startTime : 0, duration : 100 };
        triggerEntries([entry]);

        expect(monitor.entries).toEqual([entry]);
    });

    it("logs warning when observe throws (unsupported type)", () => {
        const logger = { log : vi.fn() };

        class ThrowingObserver {
            constructor(_callback : unknown) {}
            observe() { throw new Error("not supported"); }
            disconnect() {}
        }

        new TestObserverMonitor(
            "unsupported-type",
            logger,
            ThrowingObserver as unknown as PerformanceObserverInit,
        );

        expect(logger.log).toHaveBeenCalledWith(
            "warn",
            expect.stringContaining("not supported"),
            expect.any(Object),
        );
    });

    it("logs error when processEntry throws", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const logger = { log : vi.fn() };

        const monitor = new TestObserverMonitor("longtask", logger, MockCtor);
        monitor.entries = null as any; // force push to throw

        triggerEntries([{ entryType : "longtask", name : "self", startTime : 0, duration : 50 }]);

        expect(logger.log).toHaveBeenCalledWith(
            "error",
            expect.stringContaining("Error processing"),
            expect.objectContaining({ entryType : "longtask" }),
        );
    });

    it("disconnects on stop", () => {
        const { MockCtor, disconnectSpy } = createMockPerformanceObserver();
        const logger = { log : vi.fn() };

        const monitor = new TestObserverMonitor("longtask", logger, MockCtor);
        monitor.stop();

        expect(disconnectSpy).toHaveBeenCalled();
    });

    it("prevents double-start", () => {
        const mock = createMockPerformanceObserver();
        const logger = { log : vi.fn() };

        const monitor = new TestObserverMonitor("longtask", logger, mock.MockCtor);
        monitor.start(); // should not create second observer

        expect(mock.constructCount).toBe(1);
    });
});
