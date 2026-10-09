/** The tracks of the session timeline, and their vertical layout. */

export type TrackId =
    | "pageViews"
    | "lifecycle"
    | "pressure"
    | "drift"
    | "macrotask"
    | "frames"
    | "blocks"
    | "vitals"
    | "loads";

export type TrackSpec = {
    readonly id : TrackId;
    /** The name on the timeline and on its check box. */
    readonly label : string;
    /** What the track shows. */
    readonly description : string;
    /** The height of the content, in CSS pixels. */
    readonly height : number;
};

/** The tracks from top to bottom. */
export const TRACKS : readonly TrackSpec[] = [
    { id : "pageViews", label : "Page views", description : "The span lag.page_view of each page view: the root of its trace.", height : 22 },
    { id : "lifecycle", label : "Lifecycle", description : "The Page Lifecycle state: active, passive, hidden or frozen.", height : 18 },
    { id : "loads", label : "Load from this page", description : "The load actions and the profiles that you started.", height : 18 },
    { id : "drift", label : "Drift lag", description : "The lag of each window of DriftLag, in ms.", height : 64 },
    { id : "macrotask", label : "Macrotask lag", description : "The queue delay of each zero-delay timeout of MacrotaskLag, in ms.", height : 40 },
    { id : "frames", label : "Long animation frames", description : "Each frame of 50 ms or more. The dark part has the length of the blocking time.", height : 24 },
    { id : "blocks", label : "Hangs and stalls", description : "The hangs that the worker detected, and the stall episodes of the measurement conditions.", height : 34 },
    { id : "vitals", label : "Web Vitals", description : "FCP, LCP and CLS shifts, and each interaction with its duration.", height : 40 },
    { id : "pressure", label : "Compute pressure", description : "The compute pressure state of each source: nominal, fair, serious or critical.", height : 18 },
];

export const ALL_TRACKS : ReadonlySet<TrackId> = new Set(TRACKS.map(track => track.id));

export type TrackLayout = {
    readonly id : TrackId;
    readonly label : string;
    /** The top of the label row. */
    readonly top : number;
    /** The top of the content, below the label. */
    readonly contentTop : number;
    readonly contentHeight : number;
    /** The bottom of the track, with its padding. */
    readonly bottom : number;
};

export type TimelineLayout = {
    /** The height of the time axis at the top. */
    readonly axisHeight : number;
    readonly tracks : readonly TrackLayout[];
    /** The top of the overview at the bottom. */
    readonly overviewTop : number;
    readonly overviewHeight : number;
    /** The height of the whole canvas. */
    readonly height : number;
};

export type LayoutOptions = {
    axisHeight? : number;
    labelHeight? : number;
    trackPadding? : number;
    overviewHeight? : number;
};

/** This function places the visible tracks from top to bottom, under the time axis and over the overview. */
export function layoutTracks(visible : ReadonlySet<TrackId>, options : LayoutOptions = {}) : TimelineLayout {
    const axisHeight = options.axisHeight ?? 26;
    const labelHeight = options.labelHeight ?? 17;
    const padding = options.trackPadding ?? 9;
    const overviewHeight = options.overviewHeight ?? 36;
    const tracks : TrackLayout[] = [];
    let y = axisHeight;
    for (const track of TRACKS) {
        if (!visible.has(track.id)) continue;
        const top = y;
        const contentTop = top + labelHeight;
        const bottom = contentTop + track.height + padding;
        tracks.push({ id : track.id, label : track.label, top, contentTop, contentHeight : track.height, bottom });
        y = bottom;
    }
    const overviewTop = y + 8;
    return { axisHeight, tracks, overviewTop, overviewHeight, height : overviewTop + overviewHeight + 2 };
}

/** The track at the height `y`, if there is one. */
export function trackAt(layout : TimelineLayout, y : number) : TrackLayout | undefined {
    return layout.tracks.find(track => y >= track.top && y < track.bottom);
}
