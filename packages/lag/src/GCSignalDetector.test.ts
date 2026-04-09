import { vi, expect } from "vitest";
import {
    GCSignalDetector,
    type FinalizationRegistryConstructor,
    type FinalizationRegistryInstance,
} from "./GCSignalDetector.js";

/**
 * Mock FinalizationRegistry that lets us deterministically fire cleanup
 * callbacks. Real GC is non-deterministic and not testable in isolation.
 */
function createMockFinalizationRegistry() {
    const registries : Array<{
        cleanup : (heldValue : unknown) => void;
        registered : unknown[];
    }> = [];

    class MockFR<T> implements FinalizationRegistryInstance<T> {
        private idx : number;
        constructor(cleanup : (heldValue : T) => void) {
            this.idx = registries.length;
            registries.push({ cleanup : cleanup as never, registered : [] });
        }
        register(_target : object, heldValue : T) : void {
            registries[this.idx]!.registered.push(heldValue);
        }
        unregister() : void {}
    }

    return {
        Ctor : MockFR as unknown as FinalizationRegistryConstructor,
        /** Simulate the engine collecting the next pending canary on this registry. */
        triggerCollection(registryIdx = 0) : boolean {
            const r = registries[registryIdx];
            if (!r || r.registered.length === 0) return false;
            const heldValue = r.registered.shift();
            r.cleanup(heldValue);
            return true;
        },
        /** Simulate collecting all pending canaries. */
        collectAll(registryIdx = 0) : number {
            const r = registries[registryIdx];
            if (!r) return 0;
            let count = 0;
            while (r.registered.length > 0) {
                const heldValue = r.registered.shift();
                r.cleanup(heldValue);
                count++;
            }
            return count;
        },
        getRegistered(registryIdx = 0) : unknown[] {
            return registries[registryIdx]?.registered ?? [];
        },
    };
}

describe("GCSignalDetector", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("registers an initial canary on construction", () => {
        const fr = createMockFinalizationRegistry();
        new GCSignalDetector(
            fr.Ctor,
            { now : () => 0 },
            (() => 0) as never,
            vi.fn(),
            { log : vi.fn() },
        );

        expect(fr.getRegistered()).toHaveLength(1);
    });

    it("schedules periodic canary allocation", () => {
        const fr = createMockFinalizationRegistry();
        const setIntervalSpy = vi.fn(() => 1);

        new GCSignalDetector(
            fr.Ctor,
            { now : () => 0 },
            setIntervalSpy as never,
            vi.fn(),
            { log : vi.fn() },
            500,
        );

        expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 500);
    });

    it("records a GC event when a canary is collected", () => {
        let currentTime = 100;
        const fr = createMockFinalizationRegistry();
        const detector = new GCSignalDetector(
            fr.Ctor,
            { now : () => currentTime },
            (() => 0) as never,
            vi.fn(),
            { log : vi.fn() },
        );

        currentTime = 200;
        fr.triggerCollection();

        expect(detector.getTotalGCEvents()).toBe(1);
        expect(detector.getEventTimestamps()).toEqual([200]);
    });

    it("didGCRecently returns true within the window", () => {
        let currentTime = 100;
        const fr = createMockFinalizationRegistry();
        const detector = new GCSignalDetector(
            fr.Ctor,
            { now : () => currentTime },
            (() => 0) as never,
            vi.fn(),
            { log : vi.fn() },
        );

        // Simulate GC at t=100
        fr.triggerCollection();

        // Check at t=150 — within 100ms window
        currentTime = 150;
        expect(detector.didGCRecently(100)).toBe(true);

        // Check at t=300 — outside 100ms window
        currentTime = 300;
        expect(detector.didGCRecently(100)).toBe(false);
    });

    it("getRecentGCEvents counts events in window", () => {
        let currentTime = 0;
        const fr = createMockFinalizationRegistry();
        const detector = new GCSignalDetector(
            fr.Ctor,
            { now : () => currentTime },
            (() => 0) as never,
            vi.fn(),
            { log : vi.fn() },
        );

        // Collect canaries one at a time, advancing the clock between each
        currentTime = 100;
        fr.triggerCollection(); // collected at t=100

        detector.allocateCanary();
        currentTime = 200;
        fr.triggerCollection(); // collected at t=200

        detector.allocateCanary();
        currentTime = 300;
        fr.triggerCollection(); // collected at t=300

        expect(detector.getTotalGCEvents()).toBe(3);

        // All three happened within 1000ms of t=300 (now)
        expect(detector.getRecentGCEvents(1000)).toBe(3);

        // Only the last one (t=300) is within 50ms of t=300
        expect(detector.getRecentGCEvents(50)).toBe(1);

        // Within 150ms, the last two qualify
        expect(detector.getRecentGCEvents(150)).toBe(2);
    });

    it("re-allocates canaries on each interval tick", () => {
        let currentTime = 0;
        const fr = createMockFinalizationRegistry();
        let intervalCallback : (() => void) | undefined;
        const setIntervalFn = vi.fn((cb : () => void) => {
            intervalCallback = cb;
            return 1;
        });

        new GCSignalDetector(
            fr.Ctor,
            { now : () => currentTime },
            setIntervalFn as never,
            vi.fn(),
            { log : vi.fn() },
            100,
        );

        // Initial canary registered
        expect(fr.getRegistered()).toHaveLength(1);

        // Simulate 3 interval ticks
        intervalCallback?.();
        intervalCallback?.();
        intervalCallback?.();

        expect(fr.getRegistered()).toHaveLength(4);
    });

    it("respects the historySize ring buffer", () => {
        let currentTime = 0;
        const fr = createMockFinalizationRegistry();
        const detector = new GCSignalDetector(
            fr.Ctor,
            { now : () => currentTime },
            (() => 0) as never,
            vi.fn(),
            { log : vi.fn() },
            100,
            5, // historySize=5
        );

        // Allocate and collect 10 canaries (initial counts as 1)
        for (let i = 0; i < 9; i++) {
            currentTime = i * 10;
            detector.allocateCanary();
        }
        fr.collectAll();

        // Total events seen = 10, but buffer only retains last 5
        expect(detector.getTotalGCEvents()).toBe(10);
        expect(detector.getEventTimestamps()).toHaveLength(5);
    });

    it("clears interval on stop", () => {
        const fr = createMockFinalizationRegistry();
        const clearSpy = vi.fn();
        const detector = new GCSignalDetector(
            fr.Ctor,
            { now : () => 0 },
            (() => 42) as never,
            clearSpy,
            { log : vi.fn() },
        );

        detector.stop();
        expect(clearSpy).toHaveBeenCalledWith(42);
    });

    it("logs an error if cleanup callback throws", () => {
        const logger = { log : vi.fn() };
        const fr = createMockFinalizationRegistry();
        let broken = false;
        const detector = new GCSignalDetector(
            fr.Ctor,
            {
                now : () => {
                    if (broken) throw new Error("clock broken");
                    return 0;
                },
            },
            (() => 0) as never,
            vi.fn(),
            logger,
        );

        // Construction succeeded; now break the clock and trigger a collection
        broken = true;
        fr.triggerCollection();

        expect(logger.log).toHaveBeenCalledWith(
            "error",
            "Error in GC finalization callback.",
            expect.objectContaining({ type : "GCSignalDetector" }),
        );
        expect(detector).toBeDefined();
    });
});
