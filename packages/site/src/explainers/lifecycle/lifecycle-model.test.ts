import { describe, expect, it } from "vitest";
import { segmentsOf, timeInStates, type ObservedTransition } from "./lifecycle-model";

const blur : ObservedTransition = { from : "active", to : "passive", trigger : "blur", timestamp : 1_000 };
const hide : ObservedTransition = { from : "passive", to : "hidden", trigger : "visibilitychange", timestamp : 3_000 };
const show : ObservedTransition = { from : "hidden", to : "active", trigger : "visibilitychange", timestamp : 6_000 };

describe("segmentsOf", () => {
    it("gives one period for each state between the transitions", () => {
        expect(segmentsOf("active", 0, [blur, hide, show], 0, 7_000)).toEqual([
            { state : "active", start : 0, end : 1_000 },
            { state : "passive", start : 1_000, end : 3_000 },
            { state : "hidden", start : 3_000, end : 6_000 },
            { state : "active", start : 6_000, end : 7_000 },
        ]);
    });

    it("cuts the periods at the start of the window and at the current time", () => {
        expect(segmentsOf("active", 0, [blur, hide, show], 2_000, 5_000)).toEqual([
            { state : "passive", start : 2_000, end : 3_000 },
            { state : "hidden", start : 3_000, end : 5_000 },
        ]);
    });

    it("gives one period without transitions", () => {
        expect(segmentsOf("hidden", 500, [], 0, 2_500)).toEqual([{ state : "hidden", start : 500, end : 2_500 }]);
    });

    it("starts a new period for a restore with the same state", () => {
        const restore : ObservedTransition = { from : "active", to : "active", trigger : "pageshow", timestamp : 2_000 };
        expect(segmentsOf("active", 0, [restore], 0, 3_000)).toEqual([
            { state : "active", start : 0, end : 2_000 },
            { state : "active", start : 2_000, end : 3_000 },
        ]);
    });

    it("moves a transition before the observed start to the observed start", () => {
        const early : ObservedTransition = { from : "active", to : "passive", trigger : "blur", timestamp : 100 };
        expect(segmentsOf("active", 500, [early], 0, 1_000)).toEqual([{ state : "passive", start : 500, end : 1_000 }]);
    });
});

describe("timeInStates", () => {
    it("adds the time of each state", () => {
        const totals = timeInStates(segmentsOf("active", 0, [blur, hide, show], 0, 7_000));
        expect(totals).toEqual({ active : 2_000, passive : 2_000, hidden : 3_000, frozen : 0, terminated : 0 });
    });
});
