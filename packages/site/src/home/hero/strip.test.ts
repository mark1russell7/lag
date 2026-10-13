import { describe, expect, it } from "vitest";
import { interaction } from "../../playground/timeline/fixtures";
import { stripLanes, type StripInput } from "./strip";

const base : StripInput = {
    from : 4,
    to : 10,
    loads : [{ start : 6, end : 6.8, label : "Block for 800 ms", aborted : false, active : false }],
    drift : [{ t : 5.9, value : 0.2 }, { t : 6.85, value : 797 }, { t : 6.95, value : 3 }],
    workerWaits : [{ t : 6.81, value : 744 }, { t : 7, value : 20 }],
    frameDeltas : [{ t : 6.79, value : 17 }, { t : 6.82, value : 816 }],
    interactions : [interaction(1, 5.996, 830), interaction(2, 2, 40)],
};

describe("stripLanes", () => {
    it("draws each sample as the time that it lost before its end, in five lanes", () => {
        const lanes = stripLanes(base);
        expect(lanes.map(lane => lane.id)).toEqual(["load", "drift", "worker", "frames", "input"]);
        const [load, drift, worker, frames, input] = lanes;
        expect(load!.marks).toEqual([{ start : 6, end : 6.8, strong : true }]);
        expect(drift!.marks).toHaveLength(1);
        expect(drift!.marks[0]!.start).toBeCloseTo(6.053);
        expect(drift!.marks[0]!.end).toBe(6.85);
        expect(worker!.marks.map(mark => mark.strong)).toEqual([true, false]);
        expect(frames!.marks).toHaveLength(1);
        expect(input!.marks).toHaveLength(1);
    });

    it("gives a tick for each sample in the range, also without lag", () => {
        const lanes = stripLanes(base);
        expect(lanes[1]!.ticks).toEqual([5.9, 6.85, 6.95]);
        expect(lanes[0]!.ticks).toEqual([]);
    });

    it("keeps a mark that ends in the range, also when it starts before the range", () => {
        const lanes = stripLanes({ ...base, from : 6.5 });
        expect(lanes[1]!.marks).toHaveLength(1);
        expect(lanes[4]!.marks).toHaveLength(1);
        expect(stripLanes({ ...base, from : 7 })[0]!.marks).toEqual([]);
    });
});
