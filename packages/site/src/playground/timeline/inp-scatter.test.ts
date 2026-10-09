import { describe, expect, it } from "vitest";
import { frame, interaction } from "./fixtures";
import { interactionScatter, overlappingFrames, summarizeScatter } from "./inp-scatter";

describe("overlappingFrames", () => {
    const frames = [frame(1, 100, 50), frame(1.2, 300, 250), frame(1.6, 60, 10), frame(5, 2_000, 1_950)];

    it("finds the frames whose time ranges overlap the interaction", () => {
        expect(overlappingFrames(frames, { start : 1.25, end : 1.65 }).map(item => item.start)).toEqual([1.2, 1.6]);
        expect(overlappingFrames(frames, { start : 6, end : 6.1 }).map(item => item.start)).toEqual([5]);
    });

    it("does not count a frame that only touches the interaction", () => {
        expect(overlappingFrames(frames, { start : 1.1, end : 1.2 })).toEqual([]);
        expect(overlappingFrames(frames, { start : 8, end : 9 })).toEqual([]);
    });
});

describe("interactionScatter", () => {
    it("gives each interaction the blocking time of the frames that overlap it", () => {
        const points = interactionScatter({
            frames : [frame(2, 820, 770), frame(2.83, 70, 20), frame(9, 200, 150)],
            interactions : [interaction(1, 1.99, 880), interaction(2, 5, 40, "keyboard")],
        });
        expect(points).toEqual([
            expect.objectContaining({ id : 1, t : 1.99, durationMs : 880, blockingMs : 790, frames : 2, type : "pointer", rating : "poor" }),
            expect.objectContaining({ id : 2, durationMs : 40, blockingMs : 0, frames : 0, type : "keyboard", rating : "good" }),
        ]);
    });
});

describe("summarizeScatter", () => {
    it("counts the slow interactions and the interactions with frames", () => {
        const summary = summarizeScatter(interactionScatter({
            frames : [frame(2, 820, 770)],
            interactions : [interaction(1, 1.99, 880), interaction(2, 5, 40), interaction(3, 7, 260)],
        }));
        expect(summary).toMatchObject({ count : 3, withFrames : 1, slow : 2, slowWithFrames : 1 });
        expect(summary.longest?.id).toBe(1);
        expect(summarizeScatter([])).toEqual({ count : 0, withFrames : 0, slow : 0, slowWithFrames : 0, longest : undefined });
    });
});
