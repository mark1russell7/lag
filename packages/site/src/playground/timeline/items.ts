import { formatMs, formatNumber } from "../../lib/format";
import type {
    FrameItem,
    InteractionItem,
    LoadItem,
    ShiftItem,
    SpanItem,
    StateSegment,
    TimedValue,
    TimelineModel,
    VitalMark,
} from "./model";
import type { TimelineLayout, TrackId, TrackLayout } from "./tracks";
import { span as viewportSpan, type Viewport } from "./viewport";

/** One thing on the timeline that a reader can point at, select or reach with the keyboard. */
export type TimelineItem =
    | { readonly kind : "pageView"; readonly track : "pageViews"; readonly start : number; readonly end : number; readonly span : SpanItem }
    | { readonly kind : "lifecycle"; readonly track : "lifecycle"; readonly start : number; readonly end : number; readonly segment : StateSegment }
    | { readonly kind : "pressure"; readonly track : "pressure"; readonly start : number; readonly end : number; readonly segment : StateSegment }
    | { readonly kind : "load"; readonly track : "loads"; readonly start : number; readonly end : number; readonly load : LoadItem }
    | { readonly kind : "drift"; readonly track : "drift"; readonly start : number; readonly end : number; readonly point : TimedValue }
    | { readonly kind : "macrotask"; readonly track : "macrotask"; readonly start : number; readonly end : number; readonly point : TimedValue }
    | { readonly kind : "frame"; readonly track : "frames"; readonly start : number; readonly end : number; readonly frame : FrameItem }
    | { readonly kind : "hang"; readonly track : "blocks"; readonly start : number; readonly end : number; readonly span : SpanItem }
    | { readonly kind : "stall"; readonly track : "blocks"; readonly start : number; readonly end : number; readonly span : SpanItem }
    | { readonly kind : "interaction"; readonly track : "vitals"; readonly start : number; readonly end : number; readonly interaction : InteractionItem }
    | { readonly kind : "shift"; readonly track : "vitals"; readonly start : number; readonly end : number; readonly shift : ShiftItem }
    | { readonly kind : "vital"; readonly track : "vitals"; readonly start : number; readonly end : number; readonly vital : VitalMark };

export type ItemKind = TimelineItem["kind"];

/**
 * The rows inside a track, as offsets from the top of its content. The
 * drawing and the hit test use the same rows.
 */
export const ROWS = {
    hangs : { top : 0, height : 15 },
    stalls : { top : 19, height : 15 },
    marks : { top : 0, height : 17 },
    interactions : { top : 24, height : 16 },
} as const;

/** A key that stays the same for the same item in a later model. */
export function itemKey(item : TimelineItem) : string {
    switch (item.kind) {
        case "pageView":
        case "hang":
        case "stall":
            return `${item.kind}:${item.span.id}`;
        case "interaction":
            return `interaction:${item.interaction.id}`;
        case "vital":
            return `vital:${item.vital.name}:${item.start}`;
        case "lifecycle":
        case "pressure":
            return `${item.kind}:${item.segment.source ?? ""}:${item.start}`;
        default:
            return `${item.kind}:${item.start}`;
    }
}

const frameItem = (frame : FrameItem) : TimelineItem => ({ kind : "frame", track : "frames", start : frame.start, end : frame.end, frame });
const hangItem = (span : SpanItem) : TimelineItem => ({ kind : "hang", track : "blocks", start : span.start, end : span.end, span });
const stallItem = (span : SpanItem) : TimelineItem => ({ kind : "stall", track : "blocks", start : span.start, end : span.end, span });
const interactionItem = (interaction : InteractionItem) : TimelineItem => ({ kind : "interaction", track : "vitals", start : interaction.start, end : interaction.end, interaction });
const shiftItem = (shift : ShiftItem) : TimelineItem => ({ kind : "shift", track : "vitals", start : shift.t, end : shift.t, shift });
const vitalItem = (vital : VitalMark) : TimelineItem => ({ kind : "vital", track : "vitals", start : vital.t, end : vital.t, vital });
const loadItem = (load : LoadItem) : TimelineItem => ({ kind : "load", track : "loads", start : load.start, end : load.end, load });
const pageViewItem = (span : SpanItem) : TimelineItem => ({ kind : "pageView", track : "pageViews", start : span.start, end : span.end, span });
const lifecycleItem = (segment : StateSegment) : TimelineItem => ({ kind : "lifecycle", track : "lifecycle", start : segment.start, end : segment.end, segment });
const pressureItem = (segment : StateSegment) : TimelineItem => ({ kind : "pressure", track : "pressure", start : segment.start, end : segment.end, segment });

/** The items of the visible tracks, sorted by their start, for the keyboard and the table. The values of the line tracks are not items. */
export function timelineItems(model : TimelineModel, visible : ReadonlySet<TrackId>) : TimelineItem[] {
    const items : TimelineItem[] = [];
    if (visible.has("pageViews")) items.push(...model.pageViews.map(pageViewItem));
    if (visible.has("lifecycle")) items.push(...model.lifecycle.map(lifecycleItem));
    if (visible.has("loads")) items.push(...model.loads.map(loadItem));
    if (visible.has("frames")) items.push(...model.frames.map(frameItem));
    if (visible.has("blocks")) items.push(...model.hangs.map(hangItem), ...model.stalls.map(stallItem));
    if (visible.has("vitals")) items.push(...model.vitals.map(vitalItem), ...model.shifts.map(shiftItem), ...model.interactions.map(interactionItem));
    if (visible.has("pressure")) items.push(...model.pressure.map(pressureItem));
    return items.sort((a, b) => a.start - b.start || a.end - b.end);
}

/** The items whose time range overlaps the viewport. */
export function itemsInView(items : readonly TimelineItem[], viewport : Viewport) : TimelineItem[] {
    return items.filter(item => item.end >= viewport.start && item.start <= viewport.end);
}

/** The next item after `current` (or after `time`, without a current item), in the direction `step`. */
export function adjacentItem(items : readonly TimelineItem[], current : TimelineItem | undefined, time : number, step : 1 | -1) : TimelineItem | undefined {
    if (items.length === 0) return undefined;
    if (current) {
        const key = itemKey(current);
        const index = items.findIndex(item => itemKey(item) === key);
        if (index >= 0) return items[Math.min(items.length - 1, Math.max(0, index + step))];
    }
    if (step > 0) return items.find(item => item.start >= time) ?? items[items.length - 1];
    for (let index = items.length - 1; index >= 0; index--) {
        if (items[index]!.start <= time) return items[index];
    }
    return items[0];
}

/** The index of the first item whose `key` is at or above `value`. The list is sorted by `key`. */
export function lowerBound<T>(list : readonly T[], value : number, key : (item : T) => number) : number {
    let low = 0;
    let high = list.length;
    while (low < high) {
        const middle = (low + high) >>> 1;
        if (key(list[middle]!) < value) low = middle + 1;
        else high = middle;
    }
    return low;
}

function nearestPoint(points : readonly TimedValue[], time : number, tolerance : number) : TimedValue | undefined {
    const index = lowerBound(points, time, point => point.t);
    let best : TimedValue | undefined;
    for (const candidate of [points[index - 1], points[index]]) {
        if (!candidate) continue;
        const distance = Math.abs(candidate.t - time);
        if (distance <= tolerance && (!best || distance < Math.abs(best.t - time))) best = candidate;
    }
    return best;
}

/** The range item that covers `time` (within `tolerance`). A short item has priority over a long item that covers it. */
function coveringItem<T extends { start : number; end : number }>(list : readonly T[], time : number, tolerance : number) : T | undefined {
    let best : T | undefined;
    for (const item of list) {
        if (item.start - tolerance > time) break;
        if (item.end + tolerance < time) continue;
        if (!best || item.end - item.start < best.end - best.start) best = item;
    }
    return best;
}

function nearestMark<T>(list : readonly T[], time : number, tolerance : number, at : (item : T) => number) : T | undefined {
    let best : T | undefined;
    for (const item of list) {
        const distance = Math.abs(at(item) - time);
        if (distance <= tolerance && (!best || distance < Math.abs(at(best) - time))) best = item;
    }
    return best;
}

function inRow(y : number, track : TrackLayout, row : { top : number; height : number }) : boolean {
    const top = track.contentTop + row.top;
    return y >= top - 3 && y <= top + row.height + 3;
}

/** The pressure sources of the model, in a fixed order. Each source has one row. */
export function pressureSources(model : TimelineModel) : string[] {
    return [...new Set(model.pressure.map(segment => segment.source ?? "cpu"))].sort();
}

/**
 * The item at the point (`x`, `y`) of the timeline. `x` is relative to the
 * left edge of the plot, which is `width` pixels wide.
 */
export function hitTest(model : TimelineModel, layout : TimelineLayout, viewport : Viewport, width : number, x : number, y : number) : TimelineItem | undefined {
    const track = layout.tracks.find(candidate => y >= candidate.top && y < candidate.bottom);
    if (!track || width <= 0) return undefined;
    const secondsPerPixel = viewportSpan(viewport) / width;
    const time = viewport.start + x * secondsPerPixel;
    const tolerance = 4 * secondsPerPixel;
    const markTolerance = 8 * secondsPerPixel;
    switch (track.id) {
        case "pageViews": {
            const found = coveringItem(model.pageViews, time, tolerance);
            return found && pageViewItem(found);
        }
        case "lifecycle": {
            const found = coveringItem(model.lifecycle, time, 0);
            return found && lifecycleItem(found);
        }
        case "pressure": {
            const sources = pressureSources(model);
            const rowHeight = track.contentHeight / Math.max(1, sources.length);
            const source = sources[Math.min(sources.length - 1, Math.floor((y - track.contentTop) / rowHeight))];
            const found = coveringItem(model.pressure.filter(segment => (segment.source ?? "cpu") === source), time, 0);
            return found && pressureItem(found);
        }
        case "loads": {
            const found = coveringItem(model.loads, time, tolerance);
            return found && loadItem(found);
        }
        case "drift": {
            const found = nearestPoint(model.drift, time, 12 * secondsPerPixel);
            return found && { kind : "drift", track : "drift", start : found.t, end : found.t, point : found };
        }
        case "macrotask": {
            const found = nearestPoint(model.macrotask, time, 12 * secondsPerPixel);
            return found && { kind : "macrotask", track : "macrotask", start : found.t, end : found.t, point : found };
        }
        case "frames": {
            const found = coveringItem(model.frames, time, tolerance);
            return found && frameItem(found);
        }
        case "blocks": {
            if (inRow(y, track, ROWS.hangs)) {
                const found = coveringItem(model.hangs, time, tolerance);
                if (found) return hangItem(found);
            }
            if (inRow(y, track, ROWS.stalls)) {
                const found = coveringItem(model.stalls, time, tolerance);
                if (found) return stallItem(found);
            }
            return undefined;
        }
        case "vitals": {
            if (inRow(y, track, ROWS.marks)) {
                const vital = nearestMark(model.vitals, time, markTolerance, mark => mark.t);
                if (vital) return vitalItem(vital);
                const shift = nearestMark(model.shifts, time, markTolerance, item => item.t);
                if (shift) return shiftItem(shift);
            }
            if (inRow(y, track, ROWS.interactions)) {
                const found = coveringItem(model.interactions, time, tolerance);
                if (found) return interactionItem(found);
            }
            return undefined;
        }
    }
}

export type ItemDescription = {
    /** The kind of the item, for example "Long animation frame". */
    readonly title : string;
    /** The main value, for example "812 ms". */
    readonly value : string;
    readonly rows : ReadonlyArray<readonly [string, string]>;
};

/** "12.31 s". */
export function formatSeconds(time : number) : string {
    return `${formatNumber(time, 2)} s`;
}

/** A layout shift score: "0.012", or "0.0004" for a very small score. */
export function formatScore(value : number) : string {
    return value !== 0 && Math.abs(value) < 0.01 ? value.toFixed(4) : value.toFixed(3);
}

function rangeText(start : number, end : number, open = false) : string {
    return open ? `${formatSeconds(start)} to now` : `${formatSeconds(start)} to ${formatSeconds(end)}`;
}

const RATING_TEXT = { "good" : "good", "needs-improvement" : "needs improvement", "poor" : "poor" } as const;

function attributeRows(attributes : Readonly<Record<string, unknown>>) : Array<readonly [string, string]> {
    return Object.entries(attributes)
        .filter(([, value]) => value !== undefined && value !== "")
        .map(([key, value]) => [key, typeof value === "number" && !Number.isInteger(value) ? formatNumber(value, 2) : String(value)] as const);
}

/** The text of an item, for the tooltip, the details, the live region and the table. */
export function describeItem(item : TimelineItem) : ItemDescription {
    switch (item.kind) {
        case "pageView":
            return {
                title : "Page view (span lag.page_view)",
                value : item.span.open ? "Open" : formatMs((item.end - item.start) * 1000),
                rows : [["Time", rangeText(item.start, item.end, item.span.open)], ...attributeRows(item.span.attributes)],
            };
        case "lifecycle":
            return {
                title : "Lifecycle state",
                value : item.segment.state,
                rows : [
                    ["Time", rangeText(item.start, item.end, item.segment.open)],
                    ...(item.segment.trigger ? [["Trigger", item.segment.trigger] as const] : []),
                ],
            };
        case "pressure":
            return {
                title : `Compute pressure (${item.segment.source ?? "cpu"})`,
                value : item.segment.state,
                rows : [["Time", rangeText(item.start, item.end, item.segment.open)]],
            };
        case "load":
            return {
                title : "Load from this page",
                value : item.load.label,
                rows : [
                    ["Time", rangeText(item.start, item.end, item.load.active)],
                    ["Duration", item.load.active ? "Running" : formatMs((item.end - item.start) * 1000)],
                    ...(item.load.aborted ? [["Result", "Stopped before its end"] as const] : []),
                ],
            };
        case "drift":
            return { title : "Drift lag (DriftLag)", value : formatMs(item.point.value), rows : [["Window end", formatSeconds(item.start)]] };
        case "macrotask":
            return { title : "Macrotask lag (MacrotaskLag)", value : formatMs(item.point.value), rows : [["Time", formatSeconds(item.start)]] };
        case "frame": {
            const { frame } = item;
            return {
                title : "Long animation frame",
                value : formatMs(frame.durationMs),
                rows : [
                    ["Time", rangeText(item.start, item.end)],
                    ["Blocking", formatMs(frame.blockingMs)],
                    ["Render", frame.renderMs > 0 ? formatMs(frame.renderMs) : "No render"],
                    ...(frame.script ? [
                        ["Longest script", `${frame.script.invoker} (${frame.script.invokerType})`] as const,
                        ["Script duration", formatMs(frame.script.durationMs)] as const,
                    ] : []),
                ],
            };
        }
        case "hang":
            return {
                title : "Hang (span lag.main_thread.hang)",
                value : formatMs((item.end - item.start) * 1000),
                rows : [["Time", rangeText(item.start, item.end)], ...attributeRows(item.span.attributes)],
            };
        case "stall":
            return {
                title : "Stall episode (span lag.stall)",
                value : formatMs((item.end - item.start) * 1000),
                rows : [["Time", rangeText(item.start, item.end)], ...attributeRows(item.span.attributes)],
            };
        case "interaction": {
            const { interaction } = item;
            return {
                title : `Interaction (${interaction.type})`,
                value : formatMs(interaction.durationMs),
                rows : [
                    ["Time", rangeText(item.start, item.end)],
                    ["Events", interaction.names.join(", ")],
                    ["Input delay", formatMs(interaction.inputDelayMs)],
                    ["Processing", formatMs(interaction.processingMs)],
                    ["Presentation delay", formatMs(interaction.presentationMs)],
                    ["Rating as INP", RATING_TEXT[interaction.rating]],
                ],
            };
        }
        case "shift":
            return { title : "Layout shift", value : formatScore(item.shift.value), rows : [["Time", formatSeconds(item.start)]] };
        case "vital":
            return {
                title : item.vital.name,
                value : item.vital.name === "CLS" ? formatScore(item.vital.value) : formatMs(item.vital.value),
                rows : [["Time", formatSeconds(item.start)], ["Rating", RATING_TEXT[item.vital.rating]]],
            };
    }
}

/** One line of text for an item, for the live region: "Long animation frame, 812 ms, at 12.31 s." */
export function itemSentence(item : TimelineItem) : string {
    const description = describeItem(item);
    return `${description.title}: ${description.value}, at ${formatSeconds(item.start)}.`;
}
