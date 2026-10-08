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

    it("skips observing types missing from supportedEntryTypes", () => {
        const mock = createMockPerformanceObserver();
        const logger = { log : vi.fn() };
        const Ctor = Object.assign(mock.MockCtor, { supportedEntryTypes : ["paint"] });

        new TestObserverMonitor("long-animation-frame", logger, Ctor);

        expect(mock.constructCount).toBe(0);
        expect(logger.log).toHaveBeenCalledWith(
            "warn",
            expect.stringContaining("not supported"),
            expect.objectContaining({ entryType : "long-animation-frame" }),
        );
    });

    it("can retry start() after observe threw", () => {
        const logger = { log : vi.fn() };
        let fail = true;
        let constructed = 0;

        class FlakyObserver {
            constructor(_callback : unknown) { constructed++; }
            observe() { if (fail) throw new Error("not yet"); }
            disconnect() {}
        }

        const monitor = new TestObserverMonitor("longtask", logger, FlakyObserver as unknown as PerformanceObserverInit);
        fail = false;
        monitor.start();

        expect(constructed).toBe(2);
    });

    it("takeRecords() processes the entries that the browser has not delivered yet", () => {
        const pending : PerformanceEntryLike[] = [{ entryType : "event", name : "click", startTime : 5, duration : 40 }];
        class QueueingObserver {
            observe() {}
            disconnect() {}
            takeRecords() { return pending.splice(0); }
        }
        const monitor = new TestObserverMonitor("event", { log : vi.fn() }, QueueingObserver as unknown as PerformanceObserverInit);

        monitor.takeRecords();
        monitor.takeRecords();

        expect(monitor.entries).toEqual([{ entryType : "event", name : "click", startTime : 5, duration : 40 }]);
    });

    it("takeRecords() does nothing without an observer or without browser support", () => {
        const mock = createMockPerformanceObserver();
        const monitor = new TestObserverMonitor("event", { log : vi.fn() }, mock.MockCtor);
        monitor.takeRecords();
        monitor.stop();
        monitor.takeRecords();

        expect(monitor.entries).toEqual([]);
    });

    it("stop() works after a start that failed, and the warning names the entry type and the error", () => {
        const logger = { log : vi.fn() };
        const Throwing = class {
            observe() { throw new Error("unsupported"); }
            disconnect() {}
        } as unknown as PerformanceObserverInit;
        const monitor = new TestObserverMonitor("test-entry", logger, Throwing);

        expect(() => monitor.stop()).not.toThrow();
        expect(logger.log).toHaveBeenCalledWith("warn", 'PerformanceObserver type "test-entry" not supported.', { error : expect.any(Error), entryType : "test-entry" });
    });
});
