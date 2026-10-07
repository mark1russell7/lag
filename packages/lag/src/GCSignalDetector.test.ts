import { vi, expect } from "vitest";
import {
    GCSignalDetector,
    type FinalizationRegistryConstructor,
    type FinalizationRegistryInstance,
} from "./GCSignalDetector.js";

/**
 * Mock FinalizationRegistry that lets us deterministically simulate GC
 * cycles. Real GC is non-deterministic and not testable in isolation.
 */
function createMockFinalizationRegistry() {
    let cleanup : ((heldValue : unknown) => void) | undefined;
    let registered : unknown[] = [];

    class MockFR<T> implements FinalizationRegistryInstance<T> {
        constructor(cb : (heldValue : T) => void) {
            cleanup = cb as (heldValue : unknown) => void;
        }
        register(_target : object, heldValue : T) : void {
            registered.push(heldValue);
        }
        unregister() : void {}
    }

    return {
        Ctor : MockFR as unknown as FinalizationRegistryConstructor,
        /** Simulate one GC cycle: every currently registered canary is collected. */
        gc() : number {
            const collected = registered;
            registered = [];
            for (const held of collected) cleanup!(held);
            return collected.length;
        },
        get pendingCanaries() : number {
            return registered.length;
        },
    };
}

function createDetector(options : { historySize? : number; now? : () => number } = {}) {
    let currentTime = 0;
    const fr = createMockFinalizationRegistry();
    const logger = { log : vi.fn() };
    const onGC = vi.fn();
    const detector = new GCSignalDetector(
        fr.Ctor,
        { now : options.now ?? (() => currentTime) },
        logger,
        onGC,
        options.historySize,
    );
    return {
        fr,
        logger,
        onGC,
        detector,
        setTime(t : number) { currentTime = t; },
    };
}

describe("GCSignalDetector", () => {
    it("arms exactly one canary on construction", () => {
        const { fr } = createDetector();
        expect(fr.pendingCanaries).toBe(1);
    });

    it("records a GC event when the canary is collected, and re-arms", () => {
        const t = createDetector();

        t.setTime(200);
        t.fr.gc();

        expect(t.detector.getTotalGCEvents()).toBe(1);
        expect(t.detector.getEventTimestamps()).toEqual([200]);
        expect(t.onGC).toHaveBeenCalledWith(200);
        expect(t.fr.pendingCanaries).toBe(1);
    });

    it("counts one event per GC cycle, however long the gap between cycles", () => {
        const t = createDetector();

        for (let i = 1; i <= 3; i++) {
            t.setTime(i * 10_000);
            t.fr.gc();
        }

        expect(t.detector.getTotalGCEvents()).toBe(3);
        expect(t.fr.pendingCanaries).toBe(1);
    });

    it("didGCRecently returns true only within the window", () => {
        const t = createDetector();
        expect(t.detector.didGCRecently(100)).toBe(false);

        t.setTime(100);
        t.fr.gc();

        t.setTime(150);
        expect(t.detector.didGCRecently(100)).toBe(true);
        t.setTime(300);
        expect(t.detector.didGCRecently(100)).toBe(false);
    });

    it("getRecentGCEvents counts events in window", () => {
        const t = createDetector();
        for (const time of [100, 200, 300]) {
            t.setTime(time);
            t.fr.gc();
        }

        expect(t.detector.getRecentGCEvents(1000)).toBe(3);
        expect(t.detector.getRecentGCEvents(50)).toBe(1);
        expect(t.detector.getRecentGCEvents(150)).toBe(2);
    });

    it("respects the historySize ring buffer", () => {
        const t = createDetector({ historySize : 5 });
        for (let i = 0; i < 10; i++) {
            t.setTime(i * 10);
            t.fr.gc();
        }

        expect(t.detector.getTotalGCEvents()).toBe(10);
        expect(t.detector.getEventTimestamps()).toEqual([50, 60, 70, 80, 90]);
    });

    it("ignores collections after stop and doesn't re-arm", () => {
        const t = createDetector();
        t.detector.stop();

        t.fr.gc();

        expect(t.detector.getTotalGCEvents()).toBe(0);
        expect(t.fr.pendingCanaries).toBe(0);
    });

    it("re-arms on restart, without doubling up when the old canary is still pending", () => {
        const t = createDetector();
        t.detector.stop();
        t.detector.start();
        expect(t.fr.pendingCanaries).toBe(1); // the original canary is reused

        t.fr.gc();
        t.detector.stop();
        t.fr.gc(); // collected while stopped: nothing re-armed
        t.detector.start();
        expect(t.fr.pendingCanaries).toBe(1);
    });

    it("logs an error and keeps detecting if the cleanup callback throws", () => {
        let broken = false;
        const t = createDetector({
            now : () => {
                if (broken) throw new Error("clock broken");
                return 0;
            },
        });

        broken = true;
        t.fr.gc();

        expect(t.logger.log).toHaveBeenCalledWith(
            "error",
            "Error in GC finalization callback.",
            expect.objectContaining({ type : "GCSignalDetector" }),
        );
        expect(t.fr.pendingCanaries).toBe(1);
    });
});
