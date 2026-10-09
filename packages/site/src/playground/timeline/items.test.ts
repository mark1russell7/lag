import { describe, expect, it } from "vitest";
import { frame, interaction, span, testModel } from "./fixtures";
import {
    adjacentItem,
    describeItem,
    formatScore,
    hitTest,
    itemKey,
    itemSentence,
    itemsInView,
    lowerBound,
    ROWS,
    timelineItems,
    type TimelineItem,
} from "./items";
import { ALL_TRACKS, layoutTracks, type TrackId } from "./tracks";

const model = testModel({
    now : 30,
    pageViews : [{ ...span("v", "lag.page_view", -2, 30, { navigation_type : "navigate" }), open : true }],
    lifecycle : [{ start : 0, end : 30, state : "active", trigger : undefined, open : true }],
    drift : [{ t : 4.9, value : 3 }, { t : 5.0, value : 410 }, { t : 5.1, value : 2 }],
    frames : [frame(4.6, 420, 370), frame(12, 80, 30)],
    hangs : [span("h", "lag.main_thread.hang", 20, 26.1, { phase : "ended", duration_ms : 6100 })],
    stalls : [span("s", "lag.stall", 19.9, 26.2, { kind : "hang", duration_ms : 6200 })],
    interactions : [interaction(1, 4.59, 430)],
    vitals : [{ name : "LCP", t : -0.4, value : 1600, rating : "good" }],
    shifts : [{ t : 8, value : 0.004 }],
    loads : [{ start : 4.58, end : 5.0, label : "Block for 400 ms", aborted : false, active : false }],
});

const WIDTH = 1000;
const viewport = { start : 0, end : 30 };
const layout = layoutTracks(ALL_TRACKS);
const trackOf = (id : TrackId) => layout.tracks.find(track => track.id === id)!;
const xOf = (time : number) : number => ((time - viewport.start) / (viewport.end - viewport.start)) * WIDTH;

describe("timelineItems", () => {
    it("gives the items of the visible tracks, sorted by start", () => {
        const items = timelineItems(model, ALL_TRACKS);
        expect(items.map(item => item.kind)).toEqual(["pageView", "vital", "lifecycle", "load", "interaction", "frame", "shift", "frame", "stall", "hang"]);
        const withoutVitals = timelineItems(model, new Set<TrackId>(["frames", "blocks"]));
        expect(withoutVitals.map(item => item.kind)).toEqual(["frame", "frame", "stall", "hang"]);
    });

    it("finds the items that overlap the visible range", () => {
        const items = timelineItems(model, ALL_TRACKS);
        expect(itemsInView(items, { start : 10, end : 19 }).map(item => item.kind)).toEqual(["pageView", "lifecycle", "frame"]);
    });
});

describe("adjacentItem", () => {
    const items = timelineItems(model, new Set<TrackId>(["frames", "blocks"]));

    it("goes from the current item to the next and to the previous item", () => {
        expect(adjacentItem(items, items[1], 0, 1)).toBe(items[2]);
        expect(adjacentItem(items, items[1], 0, -1)).toBe(items[0]);
        expect(adjacentItem(items, items[3], 0, 1)).toBe(items[3]);
    });

    it("starts from a time without a current item", () => {
        expect(adjacentItem(items, undefined, 10, 1)).toBe(items[1]);
        expect(adjacentItem(items, undefined, 10, -1)).toBe(items[0]);
        expect(adjacentItem([], undefined, 10, 1)).toBeUndefined();
    });
});

describe("hitTest", () => {
    it("finds a long animation frame under the pointer", () => {
        const track = trackOf("frames");
        const hit = hitTest(model, layout, viewport, WIDTH, xOf(4.8), track.contentTop + 5);
        expect(hit?.kind).toBe("frame");
        expect(hitTest(model, layout, viewport, WIDTH, xOf(9), track.contentTop + 5)).toBeUndefined();
    });

    it("finds the hang in the upper row and the stall in the lower row", () => {
        const track = trackOf("blocks");
        expect(hitTest(model, layout, viewport, WIDTH, xOf(23), track.contentTop + ROWS.hangs.top + 5)?.kind).toBe("hang");
        expect(hitTest(model, layout, viewport, WIDTH, xOf(23), track.contentTop + ROWS.stalls.top + 5)?.kind).toBe("stall");
    });

    it("finds the interactions in the lower row, and the marks in the upper row of the vitals", () => {
        const track = trackOf("vitals");
        expect(hitTest(model, layout, viewport, WIDTH, xOf(4.7), track.contentTop + ROWS.interactions.top + 4)?.kind).toBe("interaction");
        expect(hitTest(model, layout, viewport, WIDTH, xOf(8) + 3, track.contentTop + ROWS.marks.top + 6)?.kind).toBe("shift");
    });

    it("finds the nearest drift window, and the lifecycle period", () => {
        const drift = hitTest(model, layout, viewport, WIDTH, xOf(5.0), trackOf("drift").contentTop + 10);
        expect(drift).toMatchObject({ kind : "drift", start : 5 });
        expect(hitTest(model, layout, viewport, WIDTH, xOf(10), trackOf("lifecycle").contentTop + 4)?.kind).toBe("lifecycle");
    });

    it("finds nothing outside the tracks", () => {
        expect(hitTest(model, layout, viewport, WIDTH, 100, 2)).toBeUndefined();
        expect(hitTest(model, layout, viewport, 0, 100, trackOf("frames").contentTop)).toBeUndefined();
    });
});

describe("describeItem", () => {
    const find = (kind : TimelineItem["kind"]) => timelineItems(model, ALL_TRACKS).find(item => item.kind === kind)!;

    it("describes a frame with its blocking time", () => {
        const description = describeItem(find("frame"));
        expect(description.title).toBe("Long animation frame");
        expect(description.value).toBe("420 ms");
        expect(description.rows).toContainEqual(["Blocking", "370 ms"]);
        expect(description.rows).toContainEqual(["Render", "No render"]);
    });

    it("describes a span with its attributes, and an open span to now", () => {
        expect(describeItem(find("hang")).rows).toContainEqual(["duration_ms", "6100"]);
        expect(describeItem(find("pageView"))).toMatchObject({ value : "Open", rows : expect.arrayContaining([["Time", "-2 s to now"]]) });
    });

    it("describes an interaction with its parts and its rating", () => {
        const description = describeItem(find("interaction"));
        expect(description.title).toBe("Interaction (pointer)");
        expect(description.rows).toContainEqual(["Rating as INP", "needs improvement"]);
    });

    it("gives one sentence for the live region", () => {
        expect(itemSentence(find("shift"))).toBe("Layout shift: 0.0040, at 8 s.");
    });

    it("gives a key that stays the same for the same item", () => {
        const first = timelineItems(model, ALL_TRACKS).map(itemKey);
        const second = timelineItems({ ...model }, ALL_TRACKS).map(itemKey);
        expect(second).toEqual(first);
        expect(new Set(first).size).toBe(first.length);
    });
});

describe("helpers", () => {
    it("formats a score with more decimals when it is very small", () => {
        expect(formatScore(0.1234)).toBe("0.123");
        expect(formatScore(0.0004)).toBe("0.0004");
        expect(formatScore(0)).toBe("0.000");
    });

    it("finds the first item at or above a value", () => {
        const list = [1, 3, 3, 7];
        expect([0, 3, 4, 8].map(value => lowerBound(list, value, item => item))).toEqual([0, 1, 3, 4]);
    });
});
