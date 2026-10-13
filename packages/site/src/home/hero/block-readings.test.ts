import { describe, expect, it } from "vitest";
import { frame, interaction } from "../../playground/timeline/fixtures";
import { blockReadings, frameInterval, keepMeasured, SETTLE_SECONDS, type BlockReadingsInput } from "./block-readings";

/** Frames of 16.7 ms from `from` to `to` (s). */
function frames(from : number, to : number) : Array<{ t : number; value : number }> {
    const points = [];
    for (let t = from; t <= to; t += 1 / 60) points.push({ t, value : 1000 / 60 });
    return points;
}

/** A block of 800 ms from 10 s, and what the monitors saw. */
function input(changes : Partial<BlockReadingsInput> = {}) : BlockReadingsInput {
    return {
        load : { id : "block-800", start : 10, end : 10.8, durationMs : 800 },
        now : 12,
        drift : [{ t : 9.9, value : 0.4 }, { t : 10.0, value : 0.2 }, { t : 10.85, value : 797 }, { t : 10.95, value : 0.3 }],
        workerWaits : [{ t : 9.95, value : 0.2 }, { t : 10.81, value : 744 }, { t : 10.81, value : 644 }, { t : 10.9, value : 0.4 }],
        frameDeltas : [...frames(8, 9.99), { t : 10.82, value : 816 }, ...frames(10.84, 11.5)],
        longFrames : [frame(9.995, 812, 762)],
        interactions : [interaction(1, 9.996, 830)],
        workerRunning : true,
        support : { longAnimationFrame : true, eventTiming : true },
        ...changes,
    };
}

describe("blockReadings", () => {
    it("gives the value of each of the five monitors for one block", () => {
        const readings = blockReadings(input());
        expect(readings.map(reading => reading.id)).toEqual(["drift", "worker", "frames", "loaf", "event"]);
        expect(readings[0]).toMatchObject({ state : "measured", valueMs : 797, windows : 1 });
        expect(readings[1]).toMatchObject({ state : "measured", valueMs : 744, heartbeats : 2 });
        expect(readings[2]).toMatchObject({ state : "measured", valueMs : 816, dropped : 48 });
        expect(readings[3]).toMatchObject({ state : "measured", valueMs : 812, blockingMs : 762 });
        expect(readings[4]).toMatchObject({ state : "measured", valueMs : 830, rating : "poor" });
    });

    it("adds the lag of all windows that the block made late, not the lag of the windows before it", () => {
        const drift = [{ t : 9.9, value : 40 }, { t : 10.3, value : 290 }, { t : 10.85, value : 500 }];
        expect(blockReadings(input({ drift }))[0]).toMatchObject({ valueMs : 790, windows : 2 });
    });

    it("waits for the values that come after the block, then gives up", () => {
        const early = input({ now : 10.85, drift : [], workerWaits : [], frameDeltas : frames(8, 9.99), longFrames : [], interactions : [] });
        expect(blockReadings(early).map(reading => reading.state)).toEqual(["waiting", "waiting", "waiting", "waiting", "waiting"]);
        const late = { ...early, now : 10.8 + SETTLE_SECONDS + 0.01 };
        expect(blockReadings(late).map(reading => reading.state)).toEqual(["missing", "missing", "missing", "missing", "missing"]);
    });

    it("gives no worker value when the heartbeats after the block did not wait", () => {
        const workerWaits = [{ t : 9.95, value : 0.2 }, { t : 11.5, value : 0.3 }];
        expect(blockReadings(input({ workerWaits }))[1]).toMatchObject({ state : "missing" });
    });

    it("marks the monitors that this browser does not support", () => {
        const readings = blockReadings(input({ workerRunning : false, support : { longAnimationFrame : false, eventTiming : false } }));
        expect(readings.filter(reading => reading.state === "unsupported").map(reading => reading.id)).toEqual(["worker", "loaf", "event"]);
    });

    it("takes the click that started the load, not a later interaction", () => {
        const interactions = [interaction(1, 8, 40), interaction(2, 9.996, 830), interaction(3, 11, 60)];
        expect(blockReadings(input({ interactions }))[4]).toMatchObject({ valueMs : 830 });
    });
});

describe("keepMeasured", () => {
    it("keeps a value that left the time window of the series", () => {
        const first = { load : input().load, readings : blockReadings(input()) };
        const later = { load : input().load, readings : blockReadings(input({ now : 20, workerWaits : [], frameDeltas : [] })) };
        expect(later.readings[1]!.state).toBe("missing");
        const kept = keepMeasured(first, later)!;
        expect(kept.readings[1]).toEqual(first.readings[1]);
        expect(kept.readings[2]).toEqual(first.readings[2]);
        expect(kept.readings[0]).toEqual(later.readings[0]);
    });

    it("keeps the larger value when the time window cuts the samples of the load", () => {
        const first = { load : input().load, readings : blockReadings(input()) };
        // The wait of 744 ms left the series, the idle heartbeat after the block is still in it
        const cut = { load : input().load, readings : blockReadings(input({ now : 20, workerWaits : [{ t : 10.9, value : 0.4 }] })) };
        expect(cut.readings[1]).toMatchObject({ state : "measured", valueMs : 0.4 });
        expect(keepMeasured(first, cut)!.readings[1]).toMatchObject({ valueMs : 744 });
        // A new window of DriftLag makes the sum larger: the new value wins
        const more = { load : input().load, readings : blockReadings(input({ drift : [...input().drift, { t : 11, value : 12 }] })) };
        expect(keepMeasured(first, more)!.readings[0]).toMatchObject({ valueMs : 809 });
    });

    it("does not keep the values of another load", () => {
        const first = { load : input().load, readings : blockReadings(input()) };
        const other = { load : { ...input().load, start : 30, end : 30.8 }, readings : blockReadings(input({ now : 30.9 })) };
        expect(keepMeasured(first, other)).toBe(other);
        expect(keepMeasured(first, undefined)).toBeUndefined();
        expect(keepMeasured(undefined, other)).toBe(other);
    });
});

describe("frameInterval", () => {
    it("gives the median frame time before the load", () => {
        expect(frameInterval([...frames(0, 1), { t : 0.5, value : 400 }], 2)).toBeCloseTo(1000 / 60);
        const fast = Array.from({ length : 20 }, (_, index) => ({ t : index / 120, value : 1000 / 120 }));
        expect(frameInterval(fast, 1)).toBeCloseTo(1000 / 120);
    });

    it("gives 60 Hz without enough frames", () => {
        expect(frameInterval([{ t : 0, value : 8 }], 1)).toBeCloseTo(1000 / 60);
    });
});
