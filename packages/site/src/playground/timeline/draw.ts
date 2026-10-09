/**
 * The canvas renderer of the session timeline. It draws only the visible
 * part. A binary search finds the first visible item of each list, and the
 * line tracks keep the highest value of each pixel column. Thus a frame
 * takes a few milliseconds, also with thousands of items.
 */
import type { ThemeColors } from "../../theme/colors";
import { readableOn, seriesColor } from "../../theme/colors";
import { formatMs } from "../../lib/format";
import { itemKey, lowerBound, pressureSources, ROWS, type TimelineItem } from "./items";
import { DRIFT_WINDOW_SECONDS, type FrameItem, type Rating, type SpanItem, type StateSegment, type TimedValue, type TimelineModel } from "./model";
import type { TimelineLayout, TrackLayout } from "./tracks";
import { span, timeTicks, type Bounds, type Viewport } from "./viewport";

/** The colors of the timeline, from the theme. Each track has its own color. */
export type TimelinePalette = {
    readonly surface : string;
    readonly sunken : string;
    readonly page : string;
    readonly ink : string;
    readonly inkSecondary : string;
    readonly inkMuted : string;
    readonly rule : string;
    readonly ruleStrong : string;
    readonly grid : string;
    readonly axis : string;
    readonly accent : string;
    readonly accentWash : string;
    readonly mark : string;
    /** The text on a solid fill of a color: white or a dark color, with the higher contrast. */
    readonly textOn : (fill : string) => string;
    readonly drift : string;
    readonly macrotask : string;
    readonly lifecycle : string;
    readonly pressure : string;
    readonly shift : string;
    readonly interaction : string;
    readonly load : string;
    readonly rating : Readonly<Record<Rating, string>>;
};

export function timelinePalette(theme : ThemeColors) : TimelinePalette {
    // The contrast calculation is the same for each fill of a color, thus the palette keeps the result
    const textColors = new Map<string, string>();
    const textOn = (fill : string) : string => {
        let color = textColors.get(fill);
        if (color === undefined) {
            color = readableOn(fill, ["#ffffff", theme.ink, theme.page]);
            textColors.set(fill, color);
        }
        return color;
    };
    return {
        surface : theme.surface,
        sunken : theme.surfaceSunken,
        page : theme.page,
        ink : theme.ink,
        inkSecondary : theme.inkSecondary,
        inkMuted : theme.inkMuted,
        rule : theme.rule,
        ruleStrong : theme.ruleStrong,
        grid : theme.chartGrid,
        axis : theme.chartAxis,
        accent : theme.accent,
        accentWash : theme.accentWash,
        mark : theme.mark,
        textOn,
        drift : seriesColor(theme, 0),
        macrotask : seriesColor(theme, 1),
        lifecycle : seriesColor(theme, 2),
        pressure : seriesColor(theme, 3),
        shift : seriesColor(theme, 4),
        interaction : seriesColor(theme, 6),
        load : theme.inkMuted,
        rating : { "good" : theme.status.good, "needs-improvement" : theme.status.warning, "poor" : theme.status.critical },
    };
}

export type HoverState = {
    /** The x of the pointer, relative to the canvas. */
    readonly x : number;
    readonly item : TimelineItem | undefined;
};

export type DrawState = {
    readonly model : TimelineModel;
    readonly layout : TimelineLayout;
    readonly viewport : Viewport;
    readonly bounds : Bounds;
    /** The width of the canvas, in CSS pixels. */
    readonly width : number;
    readonly hover : HoverState | undefined;
    /** The item that the reader selected, with a click or with the keyboard. */
    readonly selected : TimelineItem | undefined;
    readonly fonts : { readonly sans : string; readonly mono : string };
    /** The image of the overview between two frames. Without it, the renderer draws the overview each time. */
    readonly overviewCache? : OverviewCache;
};

/** The horizontal padding of the plot, in CSS pixels. */
export const PLOT_PADDING = 12;

/** The left edge and the width of the plot in the canvas. */
export function plotArea(width : number) : { left : number; width : number } {
    return { left : PLOT_PADDING, width : Math.max(1, width - 2 * PLOT_PADDING) };
}

const LIFECYCLE_ALPHA : Readonly<Record<string, number>> = { active : 0.9, passive : 0.38 };
const PRESSURE_ALPHA : Readonly<Record<string, number>> = { nominal : 0.2, fair : 0.45, serious : 0.75, critical : 1 };

type Context = CanvasRenderingContext2D;

type Frame = {
    readonly ctx : Context;
    readonly state : DrawState;
    readonly palette : TimelinePalette;
    readonly left : number;
    readonly plotWidth : number;
    readonly x : (time : number) => number;
};

function niceCeiling(value : number) : number {
    if (value <= 0) return 1;
    const power = 10 ** Math.floor(Math.log10(value));
    for (const multiple of [1, 2, 2.5, 5, 10]) {
        if (multiple * power >= value) return multiple * power;
    }
    return 10 * power;
}

function fillRect(ctx : Context, x : number, y : number, width : number, height : number, color : string, alpha = 1) : void {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, width, height);
    ctx.globalAlpha = 1;
}

/** A rectangle with a hatch of diagonal lines, for the stalls and the frozen state. */
function hatchRect(ctx : Context, x : number, y : number, width : number, height : number, color : string) : void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    const spacing = 5;
    for (let offset = -height; offset < width; offset += spacing) {
        ctx.moveTo(x + offset, y + height);
        ctx.lineTo(x + offset + height, y);
    }
    ctx.stroke();
    ctx.restore();
}

/**
 * Text in a box. The text gets an ellipsis when the box is too narrow, or
 * it disappears when fewer than 6 characters fit. The function gives true
 * when it drew the text.
 */
function boxText(ctx : Context, text : string, x : number, y : number, width : number, color : string) : boolean {
    const padding = 5;
    const available = width - 2 * padding;
    if (available < 24) return false;
    let shown = text;
    if (ctx.measureText(shown).width > available) {
        while (shown.length > 1 && ctx.measureText(`${shown}…`).width > available) shown = shown.slice(0, -1);
        if (shown.trimEnd().length < 6) return false;
        shown = `${shown.trimEnd()}…`;
    }
    ctx.fillStyle = color;
    ctx.fillText(shown, x + padding, y);
    return true;
}

/** The space under which the functions do not try a label. */
const MIN_LABEL_WIDTH = 30;

/** The first text that fits completely in `available` pixels, or undefined. A label with a cut number is not correct. */
function fittingText(ctx : Context, variants : readonly string[], available : number) : string | undefined {
    return variants.find(variant => ctx.measureText(variant).width <= available);
}

/** The first text that fits in a box, without an ellipsis. */
function boxLabel(ctx : Context, variants : readonly string[], x : number, y : number, width : number, color : string) : void {
    const text = fittingText(ctx, variants, width - 10);
    if (!text) return;
    ctx.fillStyle = color;
    ctx.fillText(text, x + 5, y);
}

/**
 * The label of a bar. It is in the visible part of the bar when it fits.
 * Else it is after the bar, when the space to `limit` (the start of the
 * next bar) is large enough. A label does not start left of `minX`, the
 * left edge of the plot.
 */
function barLabel(ctx : Context, variants : readonly string[], x0 : number, width : number, y : number, limits : { minX : number; limit : number }, inside : string, outside : string) : void {
    const visibleStart = Math.max(x0, limits.minX);
    // The shortest label needs approximately 30 px. Thousands of narrow bars must not measure text.
    if (x0 + width - visibleStart < MIN_LABEL_WIDTH && limits.limit - (x0 + width) < MIN_LABEL_WIDTH) return;
    const insideText = fittingText(ctx, variants, x0 + width - visibleStart - 10);
    if (insideText) {
        ctx.fillStyle = inside;
        ctx.fillText(insideText, visibleStart + 5, y);
        return;
    }
    const after = x0 + width + 5;
    // A label after a bar needs the end of the bar in the plot, else it has no visible bar
    const outsideText = x0 + width >= limits.minX + 2 ? fittingText(ctx, variants, limits.limit - 4 - after) : undefined;
    if (outsideText) {
        ctx.fillStyle = outside;
        ctx.fillText(outsideText, after, y);
    }
}

function visibleRange<T>(list : readonly T[], viewport : Viewport, start : (item : T) => number, longest : number) : [number, number] {
    const first = lowerBound(list, viewport.start - longest, start);
    const last = lowerBound(list, viewport.end, start);
    return [first, Math.min(list.length, last + 1)];
}

function longestOf(list : ReadonlyArray<{ start : number; end : number }>) : number {
    let longest = 0;
    for (const item of list) longest = Math.max(longest, item.end - item.start);
    return longest;
}

function emptyText(frame : Frame, track : TrackLayout, text : string) : void {
    const { ctx, palette, left } = frame;
    ctx.font = `400 12px ${frame.state.fonts.sans}`;
    ctx.textBaseline = "middle";
    ctx.fillStyle = palette.inkMuted;
    ctx.fillText(text, left + 2, track.contentTop + track.contentHeight / 2);
}

function drawAxis(frame : Frame) : void {
    const { ctx, state, palette, left, plotWidth, x } = frame;
    const { layout, viewport } = state;
    const ticks = timeTicks(viewport, plotWidth, plotWidth < 500 ? 64 : 90);
    ctx.font = `400 11px ${state.fonts.mono}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    for (const tick of ticks) {
        const px = Math.round(x(tick.t)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(px, layout.axisHeight - 6);
        ctx.lineTo(px, layout.overviewTop - 6);
        ctx.stroke();
        if (px < left - 0.5 || px > left + plotWidth + 0.5) continue;
        const half = ctx.measureText(tick.label).width / 2;
        ctx.fillStyle = palette.inkMuted;
        ctx.fillText(tick.label, Math.min(left + plotWidth - half, Math.max(left + half, px)), layout.axisHeight / 2 - 1);
    }
    ctx.textAlign = "left";
    ctx.strokeStyle = palette.rule;
    ctx.beginPath();
    ctx.moveTo(left, layout.axisHeight - 0.5);
    ctx.lineTo(left + plotWidth, layout.axisHeight - 0.5);
    ctx.stroke();
}

/** The time before the start of the session: a sunken band, because the monitors did not operate then. */
function drawBeforeSession(frame : Frame) : void {
    const { ctx, state, palette, left, x } = frame;
    const { layout, viewport } = state;
    if (viewport.start >= 0) return;
    const end = Math.min(x(0), left + frame.plotWidth);
    fillRect(ctx, left, layout.axisHeight, end - left, layout.overviewTop - 8 - layout.axisHeight, palette.sunken, 0.75);
    if (viewport.end > 0) {
        ctx.strokeStyle = palette.ruleStrong;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(Math.round(end) + 0.5, layout.axisHeight);
        ctx.lineTo(Math.round(end) + 0.5, layout.overviewTop - 8);
        ctx.stroke();
        ctx.setLineDash([]);
    }
}

/** The name of the track, and after it a count in muted text. */
function drawTrackLabel(frame : Frame, track : TrackLayout, detail? : string) : void {
    const { ctx, state, palette, left, plotWidth } = frame;
    ctx.font = `700 11px ${state.fonts.sans}`;
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = palette.inkSecondary;
    const label = track.label.toUpperCase();
    ctx.fillText(label, left, track.top + 12);
    if (detail) {
        const x = left + ctx.measureText(label).width + 10;
        ctx.font = `400 11px ${state.fonts.sans}`;
        ctx.fillStyle = palette.inkMuted;
        ctx.fillText(detail, x, track.top + 12);
    }
    ctx.strokeStyle = palette.rule;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, Math.round(track.bottom) - 0.5);
    ctx.lineTo(left + plotWidth, Math.round(track.bottom) - 0.5);
    ctx.stroke();
}

function drawSpanBars(frame : Frame, track : TrackLayout, spans : readonly SpanItem[], label : (span : SpanItem) => string) : void {
    const { ctx, state, palette, x } = frame;
    const [first, last] = visibleRange(spans, state.viewport, item => item.start, longestOf(spans));
    ctx.font = `600 12px ${state.fonts.sans}`;
    ctx.textBaseline = "middle";
    for (let index = first; index < last; index++) {
        const item = spans[index]!;
        const x0 = Math.max(frame.left - 2, x(item.start));
        const x1 = Math.min(frame.left + frame.plotWidth + 2, x(item.end));
        if (x1 < frame.left || x0 > frame.left + frame.plotWidth) continue;
        const width = Math.max(2, x1 - x0);
        const top = track.contentTop;
        const height = track.contentHeight;
        fillRect(ctx, x0, top, width, height, palette.accentWash);
        fillRect(ctx, x0, top, Math.min(3, width), height, palette.accent);
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x0, top + 0.5);
        ctx.lineTo(x0 + width, top + 0.5);
        ctx.moveTo(x0, top + height - 0.5);
        ctx.lineTo(x0 + width, top + height - 0.5);
        ctx.stroke();
        if (item.open) {
            // An open span has no end yet: a dashed edge at the present time
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(x0 + width - 0.5, top);
            ctx.lineTo(x0 + width - 0.5, top + height);
            ctx.stroke();
            ctx.setLineDash([]);
        } else {
            ctx.beginPath();
            ctx.moveTo(x0 + width - 0.5, top);
            ctx.lineTo(x0 + width - 0.5, top + height);
            ctx.stroke();
        }
        boxText(ctx, label(item), Math.max(x0, frame.left) + 3, top + height / 2 + 0.5, Math.min(x0 + width, frame.left + frame.plotWidth) - Math.max(x0, frame.left) - 3, palette.ink);
    }
}

function drawSegments(frame : Frame, top : number, height : number, segments : readonly StateSegment[], color : string, alphaOf : (state : string) => number | "hatch" | "gray") : void {
    const { ctx, state, palette, x } = frame;
    const [first, last] = visibleRange(segments, state.viewport, item => item.start, longestOf(segments));
    ctx.font = `600 11px ${state.fonts.sans}`;
    ctx.textBaseline = "middle";
    for (let index = first; index < last; index++) {
        const segment = segments[index]!;
        const x0 = Math.max(frame.left, x(segment.start));
        const x1 = Math.min(frame.left + frame.plotWidth, x(segment.end));
        if (x1 <= x0) continue;
        // A gap of 1 px between two periods
        const width = Math.max(1, x1 - x0 - 1);
        const style = alphaOf(segment.state);
        let textColor = palette.ink;
        if (style === "hatch") {
            fillRect(ctx, x0, top, width, height, palette.inkMuted, 0.18);
            hatchRect(ctx, x0, top, width, height, palette.inkMuted);
        } else if (style === "gray") {
            fillRect(ctx, x0, top, width, height, palette.inkMuted, 0.22);
        } else {
            fillRect(ctx, x0, top, width, height, color, style);
            if (style >= 0.7) textColor = palette.textOn(color);
        }
        boxText(ctx, segment.state, x0, top + height / 2 + 0.5, width, textColor);
    }
}

type LineScale = { max : number; y : (value : number) => number };

function lineScale(points : readonly TimedValue[], viewport : Viewport, top : number, height : number, minimum : number) : LineScale {
    let highest = 0;
    // The first value after the range covers its end, thus it counts too
    for (let index = lowerBound(points, viewport.start, point => point.t); index < points.length; index++) {
        highest = Math.max(highest, points[index]!.value);
        if (points[index]!.t > viewport.end) break;
    }
    const max = niceCeiling(Math.max(minimum, highest));
    return { max, y : (value) => top + height - (Math.max(0, Math.min(value, max)) / max) * height };
}

/** The grid lines of the half and the top of the scale, and the value of the top. */
function drawScale(frame : Frame, scale : LineScale) : void {
    const { ctx, state, palette } = frame;
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const fraction of [0.5, 1]) {
        const y = Math.round(scale.y(scale.max * fraction)) + 0.5;
        ctx.moveTo(frame.left, y);
        ctx.lineTo(frame.left + frame.plotWidth, y);
    }
    ctx.stroke();
    ctx.font = `400 10px ${state.fonts.mono}`;
    ctx.textBaseline = "top";
    ctx.fillStyle = palette.inkMuted;
    ctx.fillText(formatMs(scale.max), frame.left + 2, scale.y(scale.max) + 2);
}


type Step = { x0 : number; x1 : number; y : number; gap : boolean };

/** The start of the window that ends at `points[index]`: the end of the window before it, or 100 ms plus the lag before its end. */
function windowStart(points : readonly TimedValue[], index : number) : number {
    const point = points[index]!;
    return Math.max(points[index - 1]?.t ?? Number.NEGATIVE_INFINITY, point.t - DRIFT_WINDOW_SECONDS - Math.max(0, point.value) / 1000);
}

/**
 * This function draws many DriftLag windows: one column for each pixel,
 * with the highest value of the windows that cover it. A path with
 * thousands of points is slow to fill and to stroke in each frame.
 * Rectangles are fast.
 */
function drawWindowColumns(frame : Frame, points : readonly TimedValue[], first : number, scale : LineScale, baseline : number, color : string) : void {
    const { ctx, x } = frame;
    const columns = new Float64Array(Math.ceil(frame.plotWidth) + 2).fill(Number.NaN);
    for (let index = first; index < points.length; index++) {
        const point = points[index]!;
        const from = Math.max(0, Math.floor(x(windowStart(points, index)) - frame.left));
        const to = Math.min(columns.length - 1, Math.floor(x(point.t) - frame.left));
        if (from >= columns.length) break;
        for (let column = from; column <= to; column++) {
            const value = columns[column]!;
            if (Number.isNaN(value) || point.value > value) columns[column] = point.value;
        }
    }
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.3;
    for (let column = 0; column < columns.length; column++) {
        const value = columns[column]!;
        if (Number.isNaN(value)) continue;
        const y = scale.y(value);
        ctx.fillRect(frame.left + column, y, 1, baseline - y);
    }
    ctx.globalAlpha = 1;
    for (let column = 0; column < columns.length; column++) {
        const value = columns[column]!;
        if (!Number.isNaN(value)) ctx.fillRect(frame.left + column, scale.y(value) - 0.75, 1, 1.5);
    }
}

/**
 * This function draws the DriftLag windows. Each value is the lag of the
 * window that ends at its time. The window starts approximately 100 ms plus
 * the lag earlier, and the windows follow each other. Thus each value is a
 * step over its window: a block shows as a plateau, at the time that the
 * monitor measured it. With more than one window for each 2 pixels, each
 * pixel column shows its highest value, so that a short spike stays visible.
 */
function drawWindows(frame : Frame, track : TrackLayout, points : readonly TimedValue[], color : string) : void {
    const { ctx, state, x } = frame;
    const top = track.contentTop;
    const height = track.contentHeight;
    const baseline = top + height;
    const scale = lineScale(points, state.viewport, top + 2, height - 2, 20);
    drawScale(frame, scale);
    const first = Math.max(0, lowerBound(points, state.viewport.start, point => point.t) - 1);
    const last = lowerBound(points, state.viewport.end, point => point.t);
    if (last - first > frame.plotWidth / 2) {
        drawWindowColumns(frame, points, first, scale, baseline, color);
        return;
    }
    const steps : Step[] = [];
    let previousT = Number.NEGATIVE_INFINITY;
    for (let index = first; index < points.length; index++) {
        const point = points[index]!;
        const start = windowStart(points, index);
        const gap = start - previousT > 0.05;
        previousT = point.t;
        const x0 = x(start);
        const x1 = x(point.t);
        const y = scale.y(point.value);
        const last = steps[steps.length - 1];
        // Windows in the same pixel column: keep the highest
        if (last && !gap && x1 - last.x0 < 1) {
            last.x1 = x1;
            last.y = Math.min(last.y, y);
        } else {
            steps.push({ x0, x1, y, gap });
        }
        if (x0 > frame.left + frame.plotWidth) break;
    }
    if (steps.length === 0) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(frame.left, top - 1, frame.plotWidth, height + 2);
    ctx.clip();
    // The area: one closed shape for each run of windows without a gap
    ctx.beginPath();
    let runStart = -1;
    steps.forEach((step, index) => {
        if (runStart < 0 || step.gap) {
            if (runStart >= 0) ctx.lineTo(steps[index - 1]!.x1, baseline);
            ctx.moveTo(step.x0, baseline);
            runStart = index;
        }
        ctx.lineTo(step.x0, step.y);
        ctx.lineTo(step.x1, step.y);
    });
    ctx.lineTo(steps[steps.length - 1]!.x1, baseline);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = color;
    ctx.fill();
    ctx.globalAlpha = 1;
    // The outline
    ctx.beginPath();
    steps.forEach((step, index) => {
        if (index === 0 || step.gap) ctx.moveTo(step.x0, step.y);
        else ctx.lineTo(step.x0, step.y);
        ctx.lineTo(step.x1, step.y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.restore();
}

/** This function draws separate values (one each 5 s) as stems with a dot: no line between them, because nothing was measured there. */
function drawLollipops(frame : Frame, track : TrackLayout, points : readonly TimedValue[], color : string) : void {
    const { ctx, state, palette, x } = frame;
    const top = track.contentTop;
    const height = track.contentHeight;
    const scale = lineScale(points, state.viewport, top + 5, height - 5, 5);
    drawScale(frame, scale);
    for (let index = lowerBound(points, state.viewport.start - 1, point => point.t); index < points.length; index++) {
        const point = points[index]!;
        const px = x(point.t);
        if (px > frame.left + frame.plotWidth + 5) break;
        const py = scale.y(point.value);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, top + height);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = palette.surface;
        ctx.stroke();
    }
}

function drawFrames(frame : Frame, track : TrackLayout) : void {
    const { ctx, state, palette, x } = frame;
    const frames = state.model.frames;
    const [first, last] = visibleRange(frames, state.viewport, item => item.start, longestOf(frames));
    const top = track.contentTop;
    const height = track.contentHeight;
    const pixelsPerMs = frame.plotWidth / span(state.viewport) / 1000;
    const bars : Array<{ x0 : number; width : number; blocking : number; item : FrameItem }> = [];
    for (let index = first; index < last; index++) {
        const item = frames[index]!;
        const x0 = x(item.start);
        const x1 = x(item.end);
        if (x1 < frame.left || x0 > frame.left + frame.plotWidth) continue;
        // A wide frame leaves a gap of 1 px before the next frame. A narrow frame stays at its place.
        const width = x1 - x0 > 4 ? x1 - x0 - 1 : Math.max(1, x1 - x0);
        bars.push({ x0, width, blocking : Math.min(width, Math.max(item.blockingMs > 0 ? 1 : 0, item.blockingMs * pixelsPerMs)), item });
    }
    // One fill style for each pass, and one rectangle for each run of frames in the same pixels
    ctx.fillStyle = palette.mark;
    ctx.globalAlpha = 0.2;
    for (const run of mergeRuns(bars.map(bar => ({ x0 : bar.x0, x1 : bar.x0 + bar.width })))) ctx.fillRect(run.x0, top, run.x1 - run.x0, height);
    ctx.globalAlpha = 1;
    for (const run of mergeRuns(bars.filter(bar => bar.blocking > 0).map(bar => ({ x0 : bar.x0, x1 : bar.x0 + bar.blocking })))) ctx.fillRect(run.x0, top + 4, run.x1 - run.x0, height - 8);
    ctx.font = `600 11px ${state.fonts.sans}`;
    ctx.textBaseline = "middle";
    for (const { x0, width, blocking, item } of bars) {
        if (width <= 70) continue;
        const variants = [`${formatMs(item.durationMs)}, ${formatMs(item.blockingMs)} blocking`, formatMs(item.durationMs)];
        // On the dark blocking part when it fits, else on the light rest of the frame
        const visible = Math.max(x0, frame.left);
        if (fittingText(ctx, variants, x0 + blocking - visible - 10)) boxLabel(ctx, variants, visible, top + height / 2 + 0.5, x0 + blocking - visible, palette.textOn(palette.mark));
        else boxLabel(ctx, variants, Math.max(x0 + blocking, frame.left), top + height / 2 + 0.5, x0 + width - Math.max(x0 + blocking, frame.left), palette.ink);
    }
}

function drawBlocks(frame : Frame, track : TrackLayout) : void {
    const { ctx, state, palette, x } = frame;
    const { hangs, stalls } = state.model;
    ctx.font = `600 11px ${state.fonts.sans}`;
    ctx.textBaseline = "middle";
    const rows : Array<[readonly SpanItem[], { top : number; height : number }, boolean]> = [[hangs, ROWS.hangs, false], [stalls, ROWS.stalls, true]];
    for (const [list, row, hatched] of rows) {
        const [first, last] = visibleRange(list, state.viewport, item => item.start, longestOf(list));
        const top = track.contentTop + row.top;
        for (let index = first; index < last; index++) {
            const item = list[index]!;
            const x0 = Math.max(x(item.start), frame.left - 2);
            const width = Math.max(3, x(item.end) - x0);
            const suspend = item.attributes["kind"] === "suspend";
            const color = suspend ? palette.inkMuted : palette.mark;
            const duration = formatMs((item.end - item.start) * 1000);
            if (hatched) {
                fillRect(ctx, x0, top, width, row.height, color, 0.14);
                hatchRect(ctx, x0, top, width, row.height, color);
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.strokeRect(x0 + 0.5, top + 0.5, width - 1, row.height - 1);
                const kind = String(item.attributes["kind"] ?? "stall");
                const text = fittingText(ctx, [`stall (${kind}), ${duration}`, "stall"], width - 10);
                if (text) {
                    fillRect(ctx, x0 + 2, top + 2, ctx.measureText(text).width + 6, row.height - 4, palette.surface, 0.92);
                    ctx.fillStyle = palette.ink;
                    ctx.fillText(text, x0 + 5, top + row.height / 2 + 0.5);
                }
            } else {
                fillRect(ctx, x0, top, width, row.height, color);
                boxLabel(ctx, [`hang, ${duration}`, "hang"], x0, top + row.height / 2 + 0.5, width, palette.textOn(color));
            }
        }
    }
}

function diamond(ctx : Context, cx : number, cy : number, radius : number) : void {
    ctx.beginPath();
    ctx.moveTo(cx, cy - radius);
    ctx.lineTo(cx + radius, cy);
    ctx.lineTo(cx, cy + radius);
    ctx.lineTo(cx - radius, cy);
    ctx.closePath();
}

function drawVitals(frame : Frame, track : TrackLayout) : void {
    const { ctx, state, palette, x } = frame;
    const { vitals, shifts, interactions } = state.model;
    const marksTop = track.contentTop + ROWS.marks.top;
    const marksMiddle = marksTop + ROWS.marks.height / 2;

    // Layout shifts: small triangles under the marks, in one path, and at most one each 3 px
    ctx.beginPath();
    let previousShift = Number.NEGATIVE_INFINITY;
    for (let index = lowerBound(shifts, state.viewport.start - span(state.viewport) * 0.01, shift => shift.t); index < shifts.length; index++) {
        const px = x(shifts[index]!.t);
        if (px > frame.left + frame.plotWidth + 6) break;
        if (px - previousShift < 3) continue;
        previousShift = px;
        ctx.moveTo(px, marksTop + 3);
        ctx.lineTo(px + 5, marksTop + ROWS.marks.height - 2);
        ctx.lineTo(px - 5, marksTop + ROWS.marks.height - 2);
        ctx.closePath();
    }
    ctx.fillStyle = palette.shift;
    ctx.fill();

    // The values of the vitals: a diamond in the color of the rating, and the name and value as text
    const positions = vitals.map(vital => x(vital.t));
    vitals.forEach((vital, index) => {
        const px = positions[index]!;
        if (px < frame.left - 8 || px > frame.left + frame.plotWidth + 8) return;
        ctx.strokeStyle = palette.inkSecondary;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(px) + 0.5, marksMiddle);
        ctx.lineTo(Math.round(px) + 0.5, track.contentTop + track.contentHeight);
        ctx.stroke();
        diamond(ctx, px, marksMiddle, 5.5);
        ctx.fillStyle = palette.rating[vital.rating];
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = palette.surface;
        ctx.stroke();
    });
    // A label needs the space to the next diamond. Thus in a group of close marks, only the last mark has a label.
    // The tooltip and the table give each value.
    ctx.font = `700 11px ${state.fonts.sans}`;
    ctx.textBaseline = "middle";
    vitals.forEach((vital, index) => {
        const px = positions[index]!;
        const value = vital.name === "CLS" ? vital.value.toFixed(3) : formatMs(vital.value);
        const text = `${vital.name} ${value}`;
        const limit = positions[index + 1] ?? frame.left + frame.plotWidth + 200;
        if (px < frame.left || px + 9 + ctx.measureText(text).width + 6 > limit) return;
        ctx.fillStyle = palette.ink;
        ctx.fillText(text, px + 9, marksMiddle + 0.5);
    });

    // Interactions: a bar for each, from its start to its end
    const [first, last] = visibleRange(interactions, state.viewport, item => item.start, longestOf(interactions));
    const top = track.contentTop + ROWS.interactions.top;
    const height = ROWS.interactions.height;
    const ranges : Array<{ x0 : number; x1 : number }> = [];
    for (let index = first; index < last; index++) {
        const item = interactions[index]!;
        const x0 = x(item.start);
        ranges.push({ x0, x1 : x0 + Math.max(3, x(item.end) - x0) });
    }
    ctx.fillStyle = palette.interaction;
    ctx.globalAlpha = 0.85;
    for (const run of mergeRuns(ranges)) ctx.fillRect(run.x0, top, run.x1 - run.x0, height);
    ctx.globalAlpha = 1;
    ctx.font = `600 11px ${state.fonts.sans}`;
    const insideColor = palette.textOn(palette.interaction);
    for (let index = first; index < last; index++) {
        const item = interactions[index]!;
        const x0 = x(item.start);
        const width = Math.max(3, x(item.end) - x0);
        const next = interactions[index + 1];
        const limit = next ? x(next.start) : frame.left + frame.plotWidth;
        barLabel(ctx, [`${item.names[item.names.length - 1] ?? "event"}, ${formatMs(item.durationMs)}`, formatMs(item.durationMs)], x0, width, top + height / 2 + 0.5, { minX : frame.left, limit }, insideColor, palette.inkSecondary);
    }
}

function drawPressure(frame : Frame, track : TrackLayout) : void {
    const { state, palette } = frame;
    const sources = pressureSources(state.model);
    const rowHeight = track.contentHeight / Math.max(1, sources.length);
    sources.forEach((source, index) => {
        const segments = state.model.pressure.filter(segment => (segment.source ?? "cpu") === source);
        drawSegments(frame, track.contentTop + index * rowHeight, rowHeight - (sources.length > 1 ? 2 : 0), segments, palette.pressure, value => PRESSURE_ALPHA[value] ?? 0.2);
    });
}

function drawLoads(frame : Frame, track : TrackLayout) : void {
    const { ctx, state, palette, x } = frame;
    const loads = state.model.loads;
    const [first, last] = visibleRange(loads, state.viewport, item => item.start, longestOf(loads));
    ctx.font = `600 11px ${state.fonts.sans}`;
    ctx.textBaseline = "middle";
    for (let index = first; index < last; index++) {
        const item = loads[index]!;
        const x0 = x(item.start);
        const width = Math.max(3, x(item.end) - x0);
        fillRect(ctx, x0, track.contentTop, width, track.contentHeight, palette.load, 0.3);
        fillRect(ctx, x0, track.contentTop, Math.min(2, width), track.contentHeight, palette.inkSecondary);
        const next = loads[index + 1];
        const limit = next ? x(next.start) : frame.left + frame.plotWidth;
        barLabel(ctx, item.aborted ? [`${item.label} (stopped)`, item.label] : [item.label], x0, width, track.contentTop + track.contentHeight / 2 + 0.5, { minX : frame.left, limit }, palette.ink, palette.inkSecondary);
    }
}

function count(value : number, singular : string) : string {
    return `${value} ${value === 1 ? singular : `${singular}s`}`;
}

function lifecycleStyle(value : string) : number | "hatch" | "gray" {
    if (value === "frozen" || value === "terminated") return "hatch";
    if (value === "hidden") return "gray";
    return LIFECYCLE_ALPHA[value] ?? 0.38;
}

function drawTrack(frame : Frame, track : TrackLayout) : void {
    const { state, palette } = frame;
    const { model } = state;
    switch (track.id) {
        case "pageViews":
            drawTrackLabel(frame, track);
            if (model.pageViews.length === 0) emptyText(frame, track, "No page view span yet.");
            drawSpanBars(frame, track, model.pageViews, item => {
                const parts = [String(item.attributes["navigation_type"] ?? "page view"), String(item.attributes["lag.page_view.url"] ?? "")].filter(Boolean);
                return `lag.page_view · ${parts.join(" · ")}${item.open ? " · open" : ""}`;
            });
            return;
        case "lifecycle":
            drawTrackLabel(frame, track);
            drawSegments(frame, track.contentTop, track.contentHeight, model.lifecycle, palette.lifecycle, lifecycleStyle);
            return;
        case "pressure":
            drawTrackLabel(frame, track);
            if (model.pressure.length === 0) emptyText(frame, track, "No compute pressure records. Chromium on a desktop computer sends them.");
            drawPressure(frame, track);
            return;
        case "loads":
            drawTrackLabel(frame, track);
            if (model.loads.length === 0) emptyText(frame, track, "Select a load button above to make load.");
            drawLoads(frame, track);
            return;
        case "drift": {
            if (model.drift.length === 0) {
                drawTrackLabel(frame, track);
                emptyText(frame, track, "No values yet. DriftLag reports one value for each 100 ms window.");
                return;
            }
            drawWindows(frame, track, model.drift, palette.drift);
            drawTrackLabel(frame, track, count(model.drift.length, "window"));
            return;
        }
        case "macrotask": {
            if (model.macrotask.length === 0) {
                drawTrackLabel(frame, track);
                emptyText(frame, track, "No values yet. MacrotaskLag measures one value each 5 s.");
                return;
            }
            drawLollipops(frame, track, model.macrotask, palette.macrotask);
            drawTrackLabel(frame, track, count(model.macrotask.length, "value"));
            return;
        }
        case "frames":
            drawTrackLabel(frame, track, model.frames.length > 0 ? count(model.frames.length, "frame") : undefined);
            if (!model.support.longAnimationFrame) emptyText(frame, track, "This browser does not report long animation frames.");
            else if (model.frames.length === 0) emptyText(frame, track, "No long frames yet. A block of 50 ms or more makes one.");
            drawFrames(frame, track);
            return;
        case "blocks":
            drawTrackLabel(frame, track, model.hangs.length + model.stalls.length > 0 ? `${count(model.hangs.length, "hang")}, ${count(model.stalls.length, "stall")}` : undefined);
            if (model.hangs.length === 0 && model.stalls.length === 0) emptyText(frame, track, "No hangs and no stalls. Use “Hang for 6 s” to make one.");
            drawBlocks(frame, track);
            return;
        case "vitals":
            drawTrackLabel(frame, track, model.interactions.length > 0 ? count(model.interactions.length, "interaction") : undefined);
            if (model.vitals.length === 0 && model.interactions.length === 0 && model.shifts.length === 0) emptyText(frame, track, "No values yet.");
            drawVitals(frame, track);
            return;
    }
}

function drawNow(frame : Frame) : void {
    const { ctx, state, palette, x } = frame;
    const { layout, model } = state;
    const px = x(model.now);
    if (px < frame.left || px > frame.left + frame.plotWidth + 1) return;
    const color = model.running ? palette.accent : palette.inkMuted;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(Math.round(px) - 0.25, layout.axisHeight);
    ctx.lineTo(Math.round(px) - 0.25, layout.overviewTop - 8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(px - 5, layout.axisHeight - 7);
    ctx.lineTo(px + 5, layout.axisHeight - 7);
    ctx.lineTo(px, layout.axisHeight);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
}

function drawHover(frame : Frame) : void {
    const { ctx, state, palette } = frame;
    const hover = state.hover;
    if (!hover) return;
    const { layout } = state;
    const px = Math.round(hover.x) + 0.5;
    if (px < frame.left || px > frame.left + frame.plotWidth) return;
    ctx.strokeStyle = palette.inkMuted;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, layout.axisHeight);
    ctx.lineTo(px, layout.overviewTop - 8);
    ctx.stroke();
}

/** The outline of the selected item and of the item under the pointer. */
function drawHighlight(frame : Frame, item : TimelineItem, color : string, lineWidth : number) : void {
    const { ctx, state, x } = frame;
    const track = state.layout.tracks.find(candidate => candidate.id === item.track);
    if (!track) return;
    let top = track.contentTop;
    let height = track.contentHeight;
    if (item.kind === "hang") ({ top, height } = { top : track.contentTop + ROWS.hangs.top, height : ROWS.hangs.height });
    if (item.kind === "stall") ({ top, height } = { top : track.contentTop + ROWS.stalls.top, height : ROWS.stalls.height });
    if (item.kind === "interaction") ({ top, height } = { top : track.contentTop + ROWS.interactions.top, height : ROWS.interactions.height });
    if (item.kind === "vital" || item.kind === "shift") ({ top, height } = { top : track.contentTop + ROWS.marks.top, height : ROWS.marks.height });
    const x0 = x(item.start);
    const width = Math.max(item.end > item.start ? 3 : 0, x(item.end) - x0);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    if (width === 0) {
        ctx.beginPath();
        ctx.arc(x0, top + height / 2, 8, 0, Math.PI * 2);
        ctx.stroke();
        return;
    }
    ctx.strokeRect(x0 - 1.5, top - 1.5, width + 3, height + 3);
}

/**
 * The time range of the overview: from the earliest item to the present
 * time of the model. It changes only with the model, thus the overview
 * can keep its image between two models.
 */
export function overviewBounds(model : TimelineModel) : Bounds {
    return { start : model.start, end : Math.max(model.now, model.start + 1) };
}

/** The image of the overview without the visible range. The component keeps it between two frames. */
export type OverviewCache = {
    current : { model : TimelineModel; width : number; palette : TimelinePalette; ratio : number; image : HTMLCanvasElement } | undefined;
};

/** A mark that starts in the last pixel of the run before it extends that run. Thus thousands of items give at most one rectangle for each pixel. */
function mergeRuns(ranges : Iterable<{ x0 : number; x1 : number }>) : Array<{ x0 : number; x1 : number }> {
    const runs : Array<{ x0 : number; x1 : number }> = [];
    for (const range of ranges) {
        const last = runs[runs.length - 1];
        if (last && range.x0 <= last.x1 + 1) last.x1 = Math.max(last.x1, range.x1);
        else runs.push({ x0 : range.x0, x1 : range.x1 });
    }
    return runs;
}

function* frameRanges(frames : readonly FrameItem[], ox : (time : number) => number, minimumWidth : number) : Generator<{ x0 : number; x1 : number }> {
    for (const item of frames) {
        if (item.blockingMs < 50) continue;
        const x0 = ox(item.start);
        yield { x0, x1 : Math.max(x0 + minimumWidth, ox(item.end)) };
    }
}

/** The drift lag (the highest value of each column) and the long frames and hangs of the whole session. */
function drawOverviewImage(ctx : Context, model : TimelineModel, palette : TimelinePalette, width : number, height : number) : void {
    const bounds = overviewBounds(model);
    const total = bounds.end - bounds.start;
    const ox = (time : number) : number => ((time - bounds.start) / total) * width;
    fillRect(ctx, 0, 0, width, height, palette.sunken);
    const columns = new Float64Array(Math.ceil(width) + 1);
    let highest = 20;
    for (const point of model.drift) {
        const column = Math.floor(ox(point.t));
        if (column < 0 || column >= columns.length) continue;
        if (point.value > columns[column]!) columns[column] = point.value;
        highest = Math.max(highest, point.value);
    }
    ctx.fillStyle = palette.drift;
    ctx.globalAlpha = 0.55;
    for (let column = 0; column < columns.length; column++) {
        const value = columns[column]!;
        if (value <= 0) continue;
        const barHeight = Math.max(1, (Math.log1p(value) / Math.log1p(highest)) * (height - 8));
        ctx.fillRect(column, height - barHeight, 1, barHeight);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.mark;
    for (const run of mergeRuns(frameRanges(model.frames, ox, 1.5))) ctx.fillRect(run.x0, 0, run.x1 - run.x0, 4);
    for (const item of model.hangs) ctx.fillRect(ox(item.start), 0, Math.max(2, ox(item.end) - ox(item.start)), 6);
}

function drawOverview(frame : Frame) : void {
    const { ctx, state, palette } = frame;
    const { layout, model, viewport } = state;
    const top = layout.overviewTop;
    const height = layout.overviewHeight;
    const left = frame.left;
    const width = frame.plotWidth;
    const ratio = ctx.getTransform().a || 1;
    const cache = state.overviewCache;
    const cached = cache?.current;
    if (cache && typeof document !== "undefined") {
        if (!cached || cached.model !== model || cached.width !== width || cached.palette !== palette || cached.ratio !== ratio) {
            const image = cached?.image ?? document.createElement("canvas");
            image.width = Math.max(1, Math.round(width * ratio));
            image.height = Math.max(1, Math.round(height * ratio));
            const imageContext = image.getContext("2d");
            if (imageContext) {
                imageContext.setTransform(ratio, 0, 0, ratio, 0, 0);
                drawOverviewImage(imageContext, model, palette, width, height);
            }
            cache.current = { model, width, palette, ratio, image };
        }
        ctx.drawImage(cache.current!.image, left, top, width, height);
    } else {
        ctx.save();
        ctx.translate(left, top);
        drawOverviewImage(ctx, model, palette, width, height);
        ctx.restore();
    }

    // The visible range: the rest is dim
    const bounds = overviewBounds(model);
    const total = bounds.end - bounds.start;
    const ox = (time : number) : number => left + ((time - bounds.start) / total) * width;
    const v0 = Math.min(left + width - 2, Math.max(left, ox(viewport.start)));
    const v1 = Math.max(v0 + 2, Math.min(left + width, ox(viewport.end)));
    fillRect(ctx, left, top, v0 - left, height, palette.page, 0.6);
    fillRect(ctx, v1, top, left + width - v1, height, palette.page, 0.6);
    ctx.strokeStyle = palette.accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(v0 + 0.75, top + 0.75, Math.max(2, v1 - v0 - 1.5), height - 1.5);
}

/** This function draws the whole timeline. The context must have the scale of the device pixel ratio. */
export function drawTimeline(ctx : Context, state : DrawState, palette : TimelinePalette) : void {
    const { left, width } = plotArea(state.width);
    const viewportSpan = span(state.viewport);
    const x = (time : number) : number => left + ((time - state.viewport.start) / viewportSpan) * width;
    const frame : Frame = { ctx, state, palette, left, plotWidth : width, x };

    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = palette.surface;
    ctx.fillRect(0, 0, state.width, state.layout.height);
    drawBeforeSession(frame);
    drawAxis(frame);
    for (const track of state.layout.tracks) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(left, track.top, width, track.bottom - track.top);
        ctx.clip();
        drawTrack(frame, track);
        ctx.restore();
    }
    drawNow(frame);
    drawHover(frame);
    const hovered = state.hover?.item;
    const selected = state.selected;
    if (hovered && (!selected || itemKey(hovered) !== itemKey(selected))) drawHighlight(frame, hovered, palette.inkSecondary, 1);
    if (selected) drawHighlight(frame, selected, palette.accent, 2);
    drawOverview(frame);
    ctx.restore();
}
