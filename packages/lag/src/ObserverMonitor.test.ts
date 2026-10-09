import { vi, expect } from "vitest";
import type { PerformanceEntryLike, PerformanceEntryList, PerformanceObserverInit } from "./perf-types.js";
import type { Logger } from "./types.js";
import { ObserverMonitor } from "./ObserverMonitor.js";
import { createFakePerformanceObserver } from "./vitals/test-fakes.js";

class TestObserverMonitor extends ObserverMonitor {
    public entries : PerformanceEntryLike[] = [];

    protected processEntry(entry : PerformanceEntryLike) : void {
        this.entries.push(entry);
    }
}

/** A subclass whose constructor sets a field after the base constructor, as `EntryObserver` and `EventTimingMonitor` do. */
class DeliveryMonitor extends ObserverMonitor {
    constructor(private readonly onDelivery : (entries : readonly PerformanceEntryLike[]) => void, logger : Logger, Ctor : PerformanceObserverInit) {
        super("layout-shift", logger, Ctor);
    }

    protected override receive(entries : readonly PerformanceEntryLike[]) : void {
        this.onDelivery(entries);
    }

    protected processEntry() : void {}
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

    it("gives the buffered entries that the browser delivers inside observe() to the subclass in a microtask, as for old Safari", async () => {
        const fake = createFakePerformanceObserver(["layout-shift"], { synchronousBuffer : true });
        const entry = { entryType : "layout-shift", name : "", startTime : 5, duration : 0 };
        fake.buffer("layout-shift", entry);
        const logger = { log : vi.fn() };
        const delivered : PerformanceEntryLike[] = [];

        const monitor = new DeliveryMonitor((entries) => delivered.push(...entries), logger, fake.PerformanceObserver);
        expect(delivered).toEqual([]);
        await Promise.resolve();

        expect(delivered).toEqual([entry]);
        expect(logger.log).not.toHaveBeenCalled();
        monitor.stop();
        expect(fake.observedTypes()).toEqual([]);
    });

    it("drops a delivery from inside observe() when stop() comes before the microtask", async () => {
        const fake = createFakePerformanceObserver(["layout-shift"], { synchronousBuffer : true });
        fake.buffer("layout-shift", { entryType : "layout-shift", name : "", startTime : 5, duration : 0 });
        const delivered : PerformanceEntryLike[] = [];

        const monitor = new DeliveryMonitor((entries) => delivered.push(...entries), { log : vi.fn() }, fake.PerformanceObserver);
        monitor.stop();
        await Promise.resolve();

        expect(delivered).toEqual([]);
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
