import { describe, expect, it, vi } from "vitest";
import { WorkerClockSync } from "./WorkerClockSync.js";

/** A simulated worker whose clock is `offsetMs` ahead, with a one-way delay per exchange. */
function createExchange(offsetMs : number, oneWayDelays : number[]) {
    let mainNow = 1_000;
    const results = vi.fn();
    let pending : number | undefined;
    const sync = new WorkerClockSync(
        (id) => { pending = id; },
        () => mainNow,
        results,
        oneWayDelays.length,
    );
    const runAll = () => {
        for (const delay of oneWayDelays) {
            const id = pending!;
            pending = undefined;
            mainNow += delay;                    // request travels to the worker
            const workerTime = mainNow + offsetMs;
            mainNow += delay;                    // reply travels back
            sync.onReply(id, workerTime);
        }
    };
    return { sync, results, runAll };
}

describe("WorkerClockSync", () => {
    it("estimates the offset from the exchange with the shortest round trip", () => {
        const { sync, results, runAll } = createExchange(25, [5, 0.5, 3]);

        sync.begin();
        runAll();

        expect(results).toHaveBeenCalledTimes(1);
        expect(results.mock.calls[0]![0].roundTripMs).toBeCloseTo(1);
        expect(results.mock.calls[0]![0].offsetMs).toBeCloseTo(25);
        expect(sync.getCorrectionMs()).toBeCloseTo(25);
    });

    it("treats an offset inside the uncertainty as 0", () => {
        const { sync, runAll } = createExchange(0.8, [0.5, 0.5, 0.5]);
        sync.begin();
        runAll();
        expect(sync.getCorrectionMs()).toBe(0);
    });

    it("has no correction before a synchronization finished", () => {
        const { sync } = createExchange(100, [1]);
        expect(sync.getCorrectionMs()).toBe(0);
        expect(sync.getResult()).toBeUndefined();
    });

    it("ignores replies with an unknown ID", () => {
        const { sync, results } = createExchange(10, [1]);
        sync.begin();
        sync.onReply(999, 0);
        expect(results).not.toHaveBeenCalled();
    });
});
