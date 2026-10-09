import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { InpCalculator } from "./InpCalculator.js";

/** The INP definition, computed from all interactions without any memory limit. */
function referenceInp(interactions : ReadonlyMap<number, number>, count : number) : number {
    const sorted = [...interactions.values()].sort((a, b) => b - a);
    if (sorted.length === 0) return 0;
    return sorted[Math.min(sorted.length - 1, Math.floor(count / 50))]!;
}

describe("InpCalculator", () => {
    it("returns 0 without interactions", () => {
        expect(new InpCalculator().getINP()).toBe(0);
        expect(new InpCalculator().getINPInteractionId()).toBe(0);
    });

    it("ignores entries without an interactionId", () => {
        const inp = new InpCalculator();
        inp.add(0, 500);
        expect(inp.getINP()).toBe(0);
        expect(inp.getInteractionCount()).toBe(0);
    });

    it("uses the longest event of an interaction", () => {
        const inp = new InpCalculator();
        inp.add(7, 40);
        inp.add(7, 120);
        inp.add(7, 80);
        expect(inp.getINP()).toBe(120);
        expect(inp.getInteractionCount()).toBe(1);
        expect(inp.getINPInteractionId()).toBe(7);
    });

    it("counts interactions since the start when the browser supplies a count", () => {
        let browserCount = 40;
        const inp = new InpCalculator(() => browserCount);
        browserCount = 140;
        inp.add(1, 50);
        expect(inp.getInteractionCount()).toBe(100);
    });

    it("reset() starts a new calculation and a new count baseline", () => {
        let browserCount = 0;
        const inp = new InpCalculator(() => browserCount);
        inp.add(1, 300);
        browserCount = 60;
        inp.reset();
        browserCount = 61;
        inp.add(2, 90);
        expect(inp.getINP()).toBe(90);
        expect(inp.getInteractionCount()).toBe(1);
    });

    it("reset() with a baseline counts from that baseline", () => {
        let browserCount = 40;
        const inp = new InpCalculator(() => browserCount, 0);
        browserCount = 60;
        inp.reset(0);
        inp.add(1, 90);

        expect(inp.getInteractionCount()).toBe(60);
    });

    it("reset() without a browser count clears the calculation", () => {
        const inp = new InpCalculator();
        inp.add(1, 300);
        inp.reset();
        inp.add(2, 90);

        expect(inp.getINP()).toBe(90);
        expect(inp.getInteractionCount()).toBe(1);
    });

    it("counts the events of one interaction as one candidate, also at 50 or more interactions", () => {
        let count = 0;
        const inp = new InpCalculator(() => count);
        inp.add(1, 300);
        inp.add(1, 280);
        inp.add(2, 100);
        count = 60;

        // With 60 interactions, INP ignores the longest interaction, not the longest event
        expect(inp.getINP()).toBe(100);
        expect(inp.getINPInteractionId()).toBe(2);
    });

    it("gives the shortest kept interaction when the number of outliers is larger than the number of kept interactions", () => {
        let count = 0;
        const inp = new InpCalculator(() => count);
        for (let id = 1; id <= 10; id++) inp.add(id, 100 + id);
        count = 1_000;

        expect(inp.getINP()).toBe(101);
        expect(inp.getINPInteractionId()).toBe(1);
    });

    it("gives 0 as the longest duration without interactions", () => {
        expect(new InpCalculator().getLongestDuration()).toBe(0);
    });

    it("agrees with the reference definition for any sequence of entries (property test)", () => {
        fc.assert(fc.property(
            fc.array(fc.record({
                // Interaction IDs increase; an interaction can have several events
                idStep : fc.integer({ min : 0, max : 3 }),
                duration : fc.integer({ min : 16, max : 2_000 }),
            }), { maxLength : 600 }),
            (events) => {
                const inp = new InpCalculator();
                const all = new Map<number, number>();
                let id = 1;
                for (const { idStep, duration } of events) {
                    id += idStep;
                    inp.add(id, duration);
                    all.set(id, Math.max(all.get(id) ?? 0, duration));
                }
                // The calculator keeps 10 interactions, so it agrees while count / 50 < 10
                const count = all.size;
                if (Math.floor(count / 50) >= 10) return;
                expect(inp.getINP()).toBe(referenceInp(all, count));
            },
        ));
    });
});
