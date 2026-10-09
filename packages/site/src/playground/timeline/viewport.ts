/**
 * The visible time range of the timeline, and the operations on it: zoom,
 * pan, follow and fit. The times are seconds since the start of the
 * session. The functions are pure.
 */

export type Viewport = {
    readonly start : number;
    readonly end : number;
};

/** The times that have data: from the earliest item to the present time. */
export type Bounds = {
    readonly start : number;
    readonly end : number;
};

/** The smallest visible range: 20 ms. Then a frame of 50 ms is wider than the half of the timeline. */
export const MIN_SPAN = 0.02;

/** The range that the timeline shows at the start, and the largest range when the session is shorter. */
export const DEFAULT_SPAN = 30;

/** The space after the present time in the "follow live" mode, as a part of the range. */
export const LIVE_MARGIN = 0.03;

export function span(viewport : Viewport) : number {
    return viewport.end - viewport.start;
}

/** The largest range: all data, or `DEFAULT_SPAN` for a short session. */
export function maxSpan(bounds : Bounds) : number {
    return Math.max(DEFAULT_SPAN, bounds.end - bounds.start);
}

/**
 * This function moves and cuts a range so that it shows data. A range that
 * is shorter than all data stays in the bounds, plus a small space after the
 * present time (`LIVE_MARGIN`). A longer range starts at the start of the
 * bounds.
 */
export function clampViewport(viewport : Viewport, bounds : Bounds) : Viewport {
    const width = Math.min(maxSpan(bounds), Math.max(MIN_SPAN, span(viewport)));
    if (width >= bounds.end - bounds.start) return { start : bounds.start, end : bounds.start + width };
    const right = bounds.end + width * LIVE_MARGIN;
    let start = viewport.start;
    if (start < bounds.start) start = bounds.start;
    if (start + width > right) start = right - width;
    return { start, end : start + width };
}

/**
 * This function zooms by `factor` around the time `anchor`. The anchor stays
 * at the same place on the screen. A factor below 1 zooms in.
 */
export function zoomViewport(viewport : Viewport, factor : number, anchor : number, bounds : Bounds) : Viewport {
    const width = span(viewport);
    const next = Math.min(maxSpan(bounds), Math.max(MIN_SPAN, width * factor));
    const ratio = width > 0 ? (anchor - viewport.start) / width : 1;
    const start = anchor - ratio * next;
    return clampViewport({ start, end : start + next }, bounds);
}

/** This function moves the range by `delta` seconds. */
export function panViewport(viewport : Viewport, delta : number, bounds : Bounds) : Viewport {
    return clampViewport({ start : viewport.start + delta, end : viewport.end + delta }, bounds);
}

/**
 * The range of the same length that shows the present time near its right
 * edge. While the data is shorter than the range, the range starts at the
 * earliest data (`earliest`), and the present time moves to the right.
 */
export function followViewport(viewport : Viewport, now : number, earliest = -Infinity) : Viewport {
    const width = span(viewport);
    const end = Math.max(now + width * LIVE_MARGIN, earliest + width);
    return { start : end - width, end };
}

/** The range that shows all data. */
export function fitViewport(bounds : Bounds) : Viewport {
    return clampViewport({ start : bounds.start, end : bounds.end }, bounds);
}

export function timeToX(time : number, viewport : Viewport, width : number) : number {
    return ((time - viewport.start) / span(viewport)) * width;
}

export function xToTime(x : number, viewport : Viewport, width : number) : number {
    return viewport.start + (x / width) * span(viewport);
}

export type Tick = {
    readonly t : number;
    readonly label : string;
};

const STEPS = [1, 2, 5];

/** The tick step: 1, 2 or 5 multiplied by a power of 10, so that the ticks are at least `minSpacing` pixels apart. */
export function tickStep(viewport : Viewport, width : number, minSpacing = 90) : number {
    const target = (span(viewport) * minSpacing) / Math.max(1, width);
    const power = 10 ** Math.floor(Math.log10(Math.max(target, 1e-6)));
    for (const multiple of STEPS) {
        if (multiple * power >= target) return multiple * power;
    }
    return 10 * power;
}

/** A tick label: "12 s", "12.5 s", "12.25 s" or "−5 s" (with a minus sign). The number of decimals comes from the step. */
export function formatTick(time : number, step : number) : string {
    const decimals = Math.max(0, Math.min(3, -Math.floor(Math.log10(step) + 1e-9)));
    const value = Math.abs(time) < step / 2 ? 0 : time;
    return `${value < 0 ? "−" : ""}${Math.abs(value).toFixed(decimals)} s`;
}

/** The ticks of the time axis, at the multiples of the step in the range. */
export function timeTicks(viewport : Viewport, width : number, minSpacing = 90) : Tick[] {
    const step = tickStep(viewport, width, minSpacing);
    const first = Math.ceil(viewport.start / step);
    const last = Math.floor(viewport.end / step);
    const ticks : Tick[] = [];
    for (let index = first; index <= last; index++) {
        const t = index * step;
        ticks.push({ t, label : formatTick(t, step) });
    }
    return ticks;
}
