/**
 * The lanes of the live strip of the home page. Each lane shows the time
 * that one monitor saw as lost, as intervals on one time axis. Thus one
 * block makes a mark at the same place in each lane. The times are seconds
 * since the start of the session.
 */
import type { PlaygroundSnapshot, SeriesPoint } from "../../playground/session";
import type { InteractionItem, LoadItem, TimedValue } from "../../playground/timeline/model";

export type StripLaneId = "load" | "drift" | "worker" | "frames" | "input";

/** One interval of lost time. `strong` marks a value of 50 ms or more: a long task. */
export type StripMark = { readonly start : number; readonly end : number; readonly strong : boolean };

export type StripLane = {
    readonly id : StripLaneId;
    readonly label : string;
    /** What the lane shows, for the accessible description. */
    readonly description : string;
    readonly marks : readonly StripMark[];
    /** The times of the samples: one tick for each window, heartbeat or frame. They show that the monitor operates. */
    readonly ticks : readonly number[];
};

/** A value below this limit (ms) gets only a tick. */
export const MARK_MINIMUM_MS = 8;
/** A value at or above this limit (ms) is a long task. */
export const LONG_MS = 50;
/** A frame gap below this limit (ms) is a usual frame at 30 Hz or more. */
const FRAME_MARK_MS = 34;

export type StripInput = {
    readonly from : number;
    readonly to : number;
    readonly loads : readonly LoadItem[];
    readonly drift : readonly TimedValue[];
    readonly workerWaits : readonly SeriesPoint[];
    readonly frameDeltas : readonly SeriesPoint[];
    readonly interactions : readonly InteractionItem[];
};

function overlaps(start : number, end : number, from : number, to : number) : boolean {
    return end >= from && start <= to;
}

/** A sample at time `t` with value `v` (ms) covers the `v` ms before `t`. A window, a wait or a frame gap ends at the time of its sample. */
function lostBefore(points : readonly { t : number; value : number }[], from : number, to : number, minimumMs : number) : StripMark[] {
    return points
        .filter(point => point.value >= minimumMs && overlaps(point.t - point.value / 1000, point.t, from, to))
        .map(point => ({ start : point.t - point.value / 1000, end : point.t, strong : point.value >= LONG_MS }));
}

function ticks(points : readonly { t : number }[], from : number, to : number) : number[] {
    return points.filter(point => point.t >= from && point.t <= to).map(point => point.t);
}

export function stripLanes(input : StripInput) : StripLane[] {
    const { from, to } = input;
    return [
        {
            id : "load",
            label : "Load",
            description : "The loads that you started with the buttons.",
            marks : input.loads
                .filter(load => overlaps(load.start, load.end, from, to))
                .map(load => ({ start : load.start, end : load.end, strong : true })),
            ticks : [],
        },
        {
            id : "drift",
            label : "DriftLag",
            description : "The lag of each window of DriftLag.",
            marks : lostBefore(input.drift, from, to, MARK_MINIMUM_MS),
            ticks : ticks(input.drift, from, to),
        },
        {
            id : "worker",
            label : "Worker",
            description : "The wait of each heartbeat of the worker in the task queue of the main thread.",
            marks : lostBefore(input.workerWaits, from, to, MARK_MINIMUM_MS),
            ticks : ticks(input.workerWaits, from, to),
        },
        {
            id : "frames",
            label : "Frames",
            description : "The time between two animation frames, when it is longer than two frames at 60 Hz.",
            marks : lostBefore(input.frameDeltas, from, to, FRAME_MARK_MS),
            ticks : ticks(input.frameDeltas, from, to),
        },
        {
            id : "input",
            label : "Input",
            description : "Each interaction, from the input to the next paint.",
            marks : input.interactions
                .filter(item => overlaps(item.start, item.end, from, to))
                .map(item => ({ start : item.start, end : item.end, strong : item.durationMs >= LONG_MS })),
            ticks : [],
        },
    ];
}

/** The lanes of the last `seconds` of the snapshot. */
export function snapshotLanes(snapshot : PlaygroundSnapshot, seconds : number) : StripLane[] {
    const to = snapshot.elapsedSeconds;
    return stripLanes({
        from : to - seconds,
        to,
        loads : snapshot.timeline.loads,
        drift : snapshot.timeline.drift,
        workerWaits : snapshot.series.workerBlock.points,
        frameDeltas : snapshot.series.frameDelta.points,
        interactions : snapshot.timeline.interactions,
    });
}
