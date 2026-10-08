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

    it("keeps the most accurate result of all synchronizations", () => {
        let mainNow = 1_000;
        let pending : number | undefined;
        const results = vi.fn();
        const sync = new WorkerClockSync((id) => { pending = id; }, () => mainNow, results, 1);
        const exchange = (oneWayDelay : number, offsetMs : number) => {
            sync.begin();
            const id = pending!;
            mainNow += oneWayDelay;
            const workerTime = mainNow + offsetMs;
            mainNow += oneWayDelay;
            sync.onReply(id, workerTime);
        };

        exchange(0.25, 30);
        // A later exchange while the main thread was busy: a long round trip, a poor estimate
        exchange(40, 70);

        expect(results.mock.calls.map(c => c[0].offsetMs)).toEqual([30, 70]);
        expect(sync.getResult()).toEqual({ offsetMs : 30, roundTripMs : 0.5 });
        expect(sync.getCorrectionMs()).toBe(30);
    });

    it("uses 8 exchanges by default", () => {
        const sent : number[] = [];
        const sync = new WorkerClockSync((id) => sent.push(id), () => 0, vi.fn());
        sync.begin();
        for (let i = 0; i < 10; i++) sync.onReply(sent[sent.length - 1]!, 0);
        expect(sent).toHaveLength(8);
    });

    it("ignores replies with an unknown ID", () => {
        const { sync, results } = createExchange(10, [1]);
        sync.begin();
        sync.onReply(999, 0);
        expect(results).not.toHaveBeenCalled();
    });

    describe("rules of the exchanges", () => {
        /** A synchronization of one exchange for each `exchange()`, with a worker clock that is `offsetMs` ahead. */
        function createSync(sampleCount = 1) {
            let mainNow = 1_000;
            const sent : number[] = [];
            const results = vi.fn();
            const sync = new WorkerClockSync((id) => { sent.push(id); }, () => mainNow, results, sampleCount);
            const exchange = (oneWayDelay : number, offsetMs : number) => {
                sync.begin();
                const id = sent.at(-1)!;
                mainNow += oneWayDelay;
                const workerTime = mainNow + offsetMs;
                mainNow += oneWayDelay;
                sync.onReply(id, workerTime);
            };
            return { sync, sent, results, exchange };
        }

        it("ignores a reply to a synchronization that a new synchronization replaced", () => {
            const s = createSync(2);
            s.sync.begin();
            const replaced = s.sent[0]!;
            s.sync.begin();

            s.sync.onReply(replaced, 0);

            expect(s.sent).toEqual([1, 2]);
        });

        it("counts a reply that comes two times only one time", () => {
            const s = createSync(2);
            s.sync.begin();
            s.sync.onReply(1, 0);
            s.sync.onReply(1, 0);

            expect(s.sent).toEqual([1, 2]);
            expect(s.results).not.toHaveBeenCalled();
        });

        it("keeps the result of a later synchronization with a shorter round trip", () => {
            const s = createSync();
            s.exchange(40, 70);
            s.exchange(0.25, 30);

            expect(s.sync.getResult()).toEqual({ offsetMs : 30, roundTripMs : 0.5 });
        });

        it("corrects by an offset that is larger than half the round trip plus 1 ms, but not by an offset of that size", () => {
            const larger = createSync();
            larger.exchange(5, 12);
            const same = createSync();
            same.exchange(5, 6);

            // The round trip is 10 ms: the clocks agree within 5 + 1 = 6 ms
            expect(larger.sync.getCorrectionMs()).toBe(12);
            expect(same.sync.getCorrectionMs()).toBe(0);
        });
    });
});
