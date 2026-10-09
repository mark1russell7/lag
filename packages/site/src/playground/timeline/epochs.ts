/**
 * Hang-aligned averages: a superposed epoch analysis of the session. Each
 * long block of the main thread is one epoch. The analysis puts the start
 * (or the end) of each block at the time 0. Then it averages each signal
 * over the epochs, in bins of equal width. Thus it shows what the monitors
 * record before, during and after a typical block.
 */
import { lowerBound } from "./items";
import { DRIFT_WINDOW_SECONDS, type FrameItem, type InteractionItem, type SpanItem, type TimedValue, type TimelineModel } from "./model";

export type EpochSource = "frame" | "hang" | "stall";

/** One block of the main thread: the frames, hangs and stalls whose time ranges overlap, as one episode. */
export type BlockEpisode = {
    readonly start : number;
    readonly end : number;
    readonly sources : readonly EpochSource[];
};

export type EpochAlignment = "start" | "end";

export type EpochOptions = {
    /** The time 0 of each epoch: the start or the end of its block. */
    readonly align : EpochAlignment;
    /** The seconds before the time 0. */
    readonly before : number;
    /** The seconds after the time 0. */
    readonly after : number;
    /** The width of a bin, in seconds. */
    readonly bin : number;
};

export const DEFAULT_EPOCH_OPTIONS : EpochOptions = { align : "start", before : 2, after : 4, bin : 0.1 };

/** A frame that blocks for this time or more is a long block. */
export const MIN_BLOCKING_MS = 100;

/** The statistics of one signal in one bin, over the epochs that have a value there. */
export type BinStat = {
    /** The number of epochs with a value. */
    readonly n : number;
    readonly mean : number;
    /** The 95% confidence interval of the mean. Only for 3 or more values. */
    readonly lower : number | undefined;
    readonly upper : number | undefined;
};

export type EpochSignal = "drift" | "blocking" | "event";

export type EpochBin = {
    /** The start of the bin, in seconds from the time 0. */
    readonly offset : number;
    /** The middle of the bin. */
    readonly center : number;
    readonly drift : BinStat | undefined;
    readonly blocking : BinStat | undefined;
    readonly event : BinStat | undefined;
};

export type EpochResult = {
    readonly options : EpochOptions;
    readonly episodes : readonly BlockEpisode[];
    /** The episodes whose window has at least one bin in the recorded time. */
    readonly used : number;
    readonly bins : readonly EpochBin[];
};

/**
 * This function finds the long blocks of the session. A block is a frame
 * that blocks for `minBlockingMs` or more, a hang, or a stall of the kind
 * "hang". Items whose time ranges overlap (or are less than `gap` seconds
 * apart) are one block. For example, a block of 6 s gives a frame, a hang
 * and a stall.
 */
export function blockEpisodes(
    model : Pick<TimelineModel, "frames" | "hangs" | "stalls">,
    minBlockingMs = MIN_BLOCKING_MS,
    gap = 0.05,
) : BlockEpisode[] {
    const candidates : Array<{ start : number; end : number; source : EpochSource }> = [
        ...model.frames.filter(frame => frame.blockingMs >= minBlockingMs).map(frame => ({ start : frame.start, end : frame.end, source : "frame" as const })),
        ...model.hangs.map(span => ({ start : span.start, end : span.end, source : "hang" as const })),
        ...model.stalls.filter(isHangStall).map(span => ({ start : span.start, end : span.end, source : "stall" as const })),
    ].sort((a, b) => a.start - b.start);
    const episodes : Array<{ start : number; end : number; sources : EpochSource[] }> = [];
    for (const candidate of candidates) {
        const last = episodes[episodes.length - 1];
        if (last && candidate.start <= last.end + gap) {
            last.end = Math.max(last.end, candidate.end);
            if (!last.sources.includes(candidate.source)) last.sources.push(candidate.source);
            continue;
        }
        episodes.push({ start : candidate.start, end : candidate.end, sources : [candidate.source] });
    }
    return episodes;
}

function isHangStall(span : SpanItem) : boolean {
    return span.attributes["kind"] !== "suspend";
}

/** The two-sided 95% critical values of the t distribution, for 1 to 30 degrees of freedom. */
const T_95 = [
    12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
    2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
    2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042,
];
const T_95_LARGE : ReadonlyArray<readonly [number, number]> = [[30, 2.042], [40, 2.021], [60, 2.000], [120, 1.980], [Infinity, 1.960]];

/** The two-sided 95% critical value of the t distribution. Above 30 degrees of freedom, it interpolates linearly in 1 / df. */
export function tCritical95(degreesOfFreedom : number) : number {
    if (degreesOfFreedom < 1) return Number.NaN;
    if (degreesOfFreedom <= 30) return T_95[Math.floor(degreesOfFreedom) - 1]!;
    for (let index = 1; index < T_95_LARGE.length; index++) {
        const [high, highValue] = T_95_LARGE[index]!;
        if (degreesOfFreedom <= high) {
            const [low, lowValue] = T_95_LARGE[index - 1]!;
            const position = (1 / low - 1 / degreesOfFreedom) / (1 / low - (high === Infinity ? 0 : 1 / high));
            return lowValue + position * (highValue - lowValue);
        }
    }
    return 1.96;
}

/** The mean of the values, with the 95% confidence interval of the mean (t distribution) for 3 or more values. */
export function binStat(values : readonly number[]) : BinStat | undefined {
    const n = values.length;
    if (n === 0) return undefined;
    const mean = values.reduce((sum, value) => sum + value, 0) / n;
    if (n < 3) return { n, mean, lower : undefined, upper : undefined };
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
    const margin = tCritical95(n - 1) * Math.sqrt(variance / n);
    return { n, mean, lower : mean - margin, upper : mean + margin };
}

/**
 * The lag that DriftLag reports in the bin: the sum of the lag of the
 * windows that end in it. A window starts where the window before it ends,
 * or approximately 100 ms plus its lag before its end. A bin in a long
 * window has 0 ms: the monitor reports the block only at the end of the
 * window. A bin that no window covers (for example while the page was
 * hidden) has no value.
 */
export function reportedLagIn(points : readonly TimedValue[], from : number, to : number) : number | undefined {
    const first = lowerBound(points, from, point => point.t);
    const window = points[first];
    if (!window) return undefined;
    const previous = points[first - 1];
    const windowStart = Math.max(previous?.t ?? Number.NEGATIVE_INFINITY, window.t - DRIFT_WINDOW_SECONDS - Math.max(0, window.value) / 1000);
    if (windowStart >= to) return undefined;
    let sum = 0;
    for (let index = first; index < points.length && points[index]!.t < to; index++) sum += points[index]!.value;
    return sum;
}

function blockingIn(frames : readonly FrameItem[], from : number, to : number) : number {
    let sum = 0;
    for (let index = lowerBound(frames, from, frame => frame.start); index < frames.length && frames[index]!.start < to; index++) {
        sum += frames[index]!.blockingMs;
    }
    return sum;
}

function meanDurationIn(interactions : readonly InteractionItem[], from : number, to : number) : number | undefined {
    let sum = 0;
    let count = 0;
    for (let index = lowerBound(interactions, from, item => item.start); index < interactions.length && interactions[index]!.start < to; index++) {
        sum += interactions[index]!.durationMs;
        count++;
    }
    return count > 0 ? sum / count : undefined;
}

/**
 * This function averages three signals over the epochs:
 *
 * - `drift`: the lag that DriftLag reports in the bin (`reportedLagIn`).
 * - `blocking`: the sum of the blocking time of the long animation frames
 *   that start in the bin. A bin without a frame has 0 ms. The value is
 *   only in a browser that reports long animation frames.
 * - `event`: the mean duration of the interactions that start in the bin.
 *
 * A bin that is not completely in the recorded time (from 0 to `model.now`)
 * gives no value for its epoch. A bin that no drift window covers, or a bin
 * without an interaction, gives no value for that signal. Epochs can
 * overlap. Then a block is in the window of another block too.
 */
export function epochAverages(model : TimelineModel, episodes : readonly BlockEpisode[], options : EpochOptions = DEFAULT_EPOCH_OPTIONS) : EpochResult {
    const binCount = Math.round((options.before + options.after) / options.bin);
    const values = Array.from({ length : binCount }, () => ({ drift : [] as number[], blocking : [] as number[], event : [] as number[] }));
    const recordedFrom = 0;
    const recordedTo = model.now;
    let used = 0;
    for (const episode of episodes) {
        const zero = options.align === "start" ? episode.start : episode.end;
        let any = false;
        for (let index = 0; index < binCount; index++) {
            const from = zero - options.before + index * options.bin;
            const to = from + options.bin;
            if (from < recordedFrom || to > recordedTo) continue;
            any = true;
            const bin = values[index]!;
            const drift = reportedLagIn(model.drift, from, to);
            if (drift !== undefined) bin.drift.push(drift);
            if (model.support.longAnimationFrame) bin.blocking.push(blockingIn(model.frames, from, to));
            const event = meanDurationIn(model.interactions, from, to);
            if (event !== undefined) bin.event.push(event);
        }
        if (any) used++;
    }
    const bins = values.map((bin, index) => {
        const offset = -options.before + index * options.bin;
        return {
            offset : round(offset),
            center : round(offset + options.bin / 2),
            drift : binStat(bin.drift),
            blocking : binStat(bin.blocking),
            event : binStat(bin.event),
        };
    });
    return { options, episodes, used, bins };
}

/** This function removes the error of the floating-point sums from a bin time (for example 0.30000000000000004). */
function round(value : number) : number {
    return Math.round(value * 1e6) / 1e6;
}
