import { describe, expect, it } from "vitest";
import { ALL_TRACKS, layoutTracks, trackAt, TRACKS, type TrackId } from "./tracks";

describe("layoutTracks", () => {
    it("places the visible tracks from top to bottom without gaps", () => {
        const layout = layoutTracks(new Set<TrackId>(["drift", "pageViews"]), { axisHeight : 20, labelHeight : 10, trackPadding : 5, overviewHeight : 30 });
        expect(layout.tracks.map(track => track.id)).toEqual(["pageViews", "drift"]);
        const [pageViews, drift] = layout.tracks;
        expect(pageViews).toMatchObject({ top : 20, contentTop : 30, contentHeight : 22, bottom : 57 });
        expect(drift).toMatchObject({ top : 57, contentTop : 67, contentHeight : 64, bottom : 136 });
        expect(layout.overviewTop).toBe(144);
        expect(layout.height).toBe(144 + 30 + 2);
    });

    it("has each track once, in a fixed order", () => {
        expect(ALL_TRACKS.size).toBe(TRACKS.length);
        expect(layoutTracks(ALL_TRACKS).tracks.map(track => track.id)).toEqual(TRACKS.map(track => track.id));
    });

    it("finds the track at a height", () => {
        const layout = layoutTracks(ALL_TRACKS);
        const third = layout.tracks[2]!;
        expect(trackAt(layout, third.top)?.id).toBe(third.id);
        expect(trackAt(layout, third.bottom - 0.5)?.id).toBe(third.id);
        expect(trackAt(layout, 0)).toBeUndefined();
    });
});
