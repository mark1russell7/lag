/**
 * Models for the tests of the timeline. The application does not use this
 * module.
 */
import type { FrameItem, InteractionItem, SpanItem, TimelineModel } from "./model";
import { EMPTY_TIMELINE } from "./model";

export const ALL_SUPPORT = { longAnimationFrame : true, eventTiming : true, layoutShift : true } as const;

/** A model with no data, a present time of `now` and support for all entry types, with the given changes. */
export function testModel(changes : Partial<TimelineModel> = {}) : TimelineModel {
    return { ...EMPTY_TIMELINE, now : 60, running : true, support : ALL_SUPPORT, ...changes };
}

export function frame(start : number, durationMs : number, blockingMs : number) : FrameItem {
    return { start, end : start + durationMs / 1000, durationMs, blockingMs, renderMs : 0, script : undefined };
}

export function span(id : string, name : string, start : number, end : number, attributes : SpanItem["attributes"] = {}) : SpanItem {
    return { id, name, start, end, open : false, attributes };
}

export function interaction(id : number, start : number, durationMs : number, type : InteractionItem["type"] = "pointer") : InteractionItem {
    return {
        id,
        start,
        end : start + durationMs / 1000,
        durationMs,
        type,
        names : ["click"],
        inputDelayMs : 1,
        processingMs : durationMs - 2,
        presentationMs : 1,
        rating : durationMs <= 200 ? "good" : durationMs <= 500 ? "needs-improvement" : "poor",
    };
}
