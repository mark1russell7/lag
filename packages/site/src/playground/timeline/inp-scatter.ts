/**
 * The data of the INP and LoAF chart: each interaction of the session, with
 * the blocking time of the long animation frames that overlap it.
 */
import type { InteractionType } from "../../adapters/lag-core";
import { lowerBound } from "./items";
import type { FrameItem, InteractionItem, Rating, TimelineModel } from "./model";

export type ScatterPoint = {
    readonly id : number;
    /** The start of the interaction, in seconds since the start of the session. */
    readonly t : number;
    readonly durationMs : number;
    /** The sum of the blocking time of the frames that overlap the interaction. */
    readonly blockingMs : number;
    /** The number of frames that overlap the interaction. */
    readonly frames : number;
    readonly type : InteractionType;
    readonly names : readonly string[];
    readonly rating : Rating;
};

/** The longest frame of the session, as a limit for the search of the frames that overlap an interaction. */
function longestFrame(frames : readonly FrameItem[]) : number {
    return frames.reduce((longest, frame) => Math.max(longest, frame.end - frame.start), 0);
}

/** The frames whose time ranges overlap the time range of the interaction. The frames are sorted by their start. */
export function overlappingFrames(frames : readonly FrameItem[], interaction : Pick<InteractionItem, "start" | "end">, longest = longestFrame(frames)) : FrameItem[] {
    const result : FrameItem[] = [];
    // The frames that start before the end of the interaction, and not more than the longest frame before its start
    const last = lowerBound(frames, interaction.end, frame => frame.start);
    for (let index = last - 1; index >= 0; index--) {
        const frame = frames[index]!;
        if (frame.start < interaction.start - longest) break;
        if (frame.end > interaction.start) result.push(frame);
    }
    return result.reverse();
}

/** One point for each interaction: its duration, and the blocking time of the frames that overlap it. */
export function interactionScatter(model : Pick<TimelineModel, "frames" | "interactions">) : ScatterPoint[] {
    const longest = longestFrame(model.frames);
    return model.interactions.map(interaction => {
        const frames = overlappingFrames(model.frames, interaction, longest);
        return {
            id : interaction.id,
            t : interaction.start,
            durationMs : interaction.durationMs,
            blockingMs : frames.reduce((sum, frame) => sum + frame.blockingMs, 0),
            frames : frames.length,
            type : interaction.type,
            names : interaction.names,
            rating : interaction.rating,
        };
    });
}

export type ScatterSummary = {
    readonly count : number;
    /** The interactions that overlap at least one long animation frame. */
    readonly withFrames : number;
    /** The interactions above the "good" INP threshold. */
    readonly slow : number;
    /** The slow interactions that overlap a long animation frame. */
    readonly slowWithFrames : number;
    readonly longest : ScatterPoint | undefined;
};

export function summarizeScatter(points : readonly ScatterPoint[]) : ScatterSummary {
    const slow = points.filter(point => point.rating !== "good");
    return {
        count : points.length,
        withFrames : points.filter(point => point.frames > 0).length,
        slow : slow.length,
        slowWithFrames : slow.filter(point => point.frames > 0).length,
        longest : points.reduce<ScatterPoint | undefined>((best, point) => (!best || point.durationMs > best.durationMs ? point : best), undefined),
    };
}
