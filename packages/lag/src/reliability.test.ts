import { describe, expect, it, vi } from "vitest";
import { ReliabilityTracker } from "./reliability.js";

function createTracker(retentionMs? : number) {
    let now = 0;
    const tracker = new ReliabilityTracker({ now : () => now }, retentionMs);
    return { tracker, setNow : (t : number) => { now = t; } };
}

describe("ReliabilityTracker", () => {
    it("finds a closed interval that overlaps a window", () => {
        const { tracker } = createTracker();
        tracker.add(100, 200, "suspend");

        expect(tracker.findOverlap(150, 300)?.reason).toBe("suspend");
        expect(tracker.findOverlap(0, 150)?.reason).toBe("suspend");
        expect(tracker.findOverlap(210, 300)).toBeUndefined();
    });

    it("does not count a window that only touches a closed interval", () => {
        const { tracker } = createTracker();
        tracker.add(100, 200, "hidden");

        // A monitor that restarts when the page becomes visible starts its window at 200
        expect(tracker.findOverlap(200, 300)).toBeUndefined();
        expect(tracker.findOverlap(0, 100)).toBeUndefined();
    });

    it("counts an open interval for every window that ends after it starts, including one that ends at its start", () => {
        const { tracker, setNow } = createTracker();
        setNow(500);
        const close = tracker.open("hidden");

        expect(tracker.isUnreliableNow()).toBe(true);
        expect(tracker.findOverlap(400, 500)?.reason).toBe("hidden");
        expect(tracker.findOverlap(600, 900)?.reason).toBe("hidden");
        expect(tracker.findOverlap(100, 499)).toBeUndefined();

        setNow(700);
        close();
        expect(tracker.isUnreliableNow()).toBe(false);
        expect(tracker.findOverlap(650, 800)?.reason).toBe("hidden");
        expect(tracker.findOverlap(700, 800)).toBeUndefined();
    });

    it("closes an interval only once", () => {
        const { tracker, setNow } = createTracker();
        const close = tracker.open("frozen");
        setNow(100);
        close();
        setNow(900);
        close();

        expect(tracker.findOverlap(150, 200)).toBeUndefined();
    });

    it("ignores an interval that ends before it starts", () => {
        const { tracker } = createTracker();
        tracker.add(200, 100, "suspend");
        expect(tracker.getIntervalCount()).toBe(0);
    });

    it("forgets closed intervals after the retention time, but keeps open ones", () => {
        const { tracker, setNow } = createTracker(1_000);
        tracker.add(0, 100, "suspend");
        tracker.open("hidden");

        setNow(1_050);
        expect(tracker.getIntervalCount()).toBe(2);
        setNow(1_200);
        expect(tracker.getIntervalCount()).toBe(1);
        // Only the open interval is left
        expect(tracker.findOverlap(0, 50)?.reason).toBe("hidden");
    });

    it("notifies subscribers of each new interval until they unsubscribe", () => {
        const { tracker } = createTracker();
        const listener = vi.fn();
        const unsubscribe = tracker.subscribe(listener);

        tracker.add(1, 2, "suspend");
        tracker.open("hidden");
        unsubscribe();
        tracker.add(3, 4, "suspend");

        expect(listener.mock.calls.map(c => c[0].reason)).toEqual(["suspend", "hidden"]);
    });

    it("counts a closed interval of zero length inside a window", () => {
        const tracker = new ReliabilityTracker({ now : () => 0 });
        tracker.add(5, 5, "suspend");

        expect(tracker.findOverlap(0, 10)).toMatchObject({ start : 5, end : 5, reason : "suspend" });
    });

    it("is unreliable now while one interval is open, also when other intervals are closed", () => {
        const tracker = new ReliabilityTracker({ now : () => 100 });
        tracker.add(0, 10, "suspend");
        tracker.open("hidden");

        expect(tracker.isUnreliableNow()).toBe(true);
    });

    it("forgets an old closed interval before it searches", () => {
        let now = 0;
        const tracker = new ReliabilityTracker({ now : () => now }, 1_000);
        tracker.add(0, 10, "hidden");
        now = 5_000;

        expect(tracker.findOverlap(0, 10)).toBeUndefined();
    });
});
