/**
 * What five monitors measured for the last load of the home page. Each
 * monitor measures a different quantity of the same block. The functions
 * are pure: the instrument gives them the snapshot of its session.
 */
import type { PlaygroundSnapshot, SeriesPoint } from "../../playground/session";
import type { FrameItem, InteractionItem, Rating, TimedValue } from "../../playground/timeline/model";

export type ReadingId = "drift" | "worker" | "frames" | "loaf" | "event";

/**
 * - `measured`: the monitor gave a value.
 * - `waiting`: the monitor can still give a value. Some entries come after the next frame.
 * - `missing`: the monitor gave no value for this load.
 * - `unsupported`: this browser does not have the API of the monitor.
 */
export type ReadingState = "measured" | "waiting" | "missing" | "unsupported";

export type BlockReading =
    | { readonly id : "drift"; readonly state : ReadingState; readonly valueMs? : number; readonly windows? : number }
    | { readonly id : "worker"; readonly state : ReadingState; readonly valueMs? : number; readonly heartbeats? : number }
    | { readonly id : "frames"; readonly state : ReadingState; readonly valueMs? : number; readonly dropped? : number }
    | { readonly id : "loaf"; readonly state : ReadingState; readonly valueMs? : number; readonly blockingMs? : number }
    | {
        readonly id : "event";
        readonly state : ReadingState;
        readonly valueMs? : number;
        readonly inputDelayMs? : number;
        readonly processingMs? : number;
        readonly presentationMs? : number;
        readonly rating? : Rating;
    };

/** The last load, in seconds since the start of the session. */
export type MeasuredLoad = {
    readonly id : string;
    readonly start : number;
    readonly end : number;
    readonly durationMs : number;
};

export type BlockReadingsInput = {
    readonly load : MeasuredLoad;
    /** The present time of the session, in seconds. */
    readonly now : number;
    readonly drift : readonly TimedValue[];
    readonly workerWaits : readonly SeriesPoint[];
    readonly frameDeltas : readonly SeriesPoint[];
    readonly longFrames : readonly FrameItem[];
    readonly interactions : readonly InteractionItem[];
    readonly workerRunning : boolean;
    readonly support : { readonly longAnimationFrame : boolean; readonly eventTiming : boolean };
};

/** After this time (s) from the end of the load, a monitor without a value has no value for it. */
export const SETTLE_SECONDS = 1.5;
/** The DriftLag window that contains a block ends within one window (approximately 100 ms) after the block. */
const DRIFT_AFTER_SECONDS = 0.25;
/** A heartbeat that waited less than this time (ms) did not wait for the block. */
const WAITED_MS = 8;
/** A heartbeat that waited for the block arrives at the end of the block. */
const WORKER_AFTER_SECONDS = 0.6;
const FRAME_AFTER_SECONDS = 0.5;
/** The event of the click that started the load comes before the start of the load. */
const CLICK_BEFORE_SECONDS = 1;
const CLICK_AFTER_SECONDS = 0.05;
/** The frame interval at 60 Hz, when the session has no frames to estimate it. */
const DEFAULT_FRAME_MS = 1000 / 60;

function inRange<T extends { t : number }>(points : readonly T[], from : number, to : number) : T[] {
    return points.filter(point => point.t >= from && point.t <= to);
}

function pending(input : BlockReadingsInput, hasLaterData : boolean) : ReadingState {
    if (hasLaterData) return "missing";
    return input.now - input.load.end < SETTLE_SECONDS ? "waiting" : "missing";
}

/** The median frame time before the load: the frame interval of this display. */
export function frameInterval(deltas : readonly SeriesPoint[], before : number) : number {
    const values = deltas.filter(point => point.t < before && point.value > 0).map(point => point.value).sort((a, b) => a - b);
    if (values.length < 5) return DEFAULT_FRAME_MS;
    return values[Math.floor(values.length / 2)]!;
}

function driftReading(input : BlockReadingsInput) : BlockReading {
    const { start, end } = input.load;
    // The calibrated lag of an idle window is a fraction of a millisecond: it is not part of the block
    const late = inRange(input.drift, start, end + DRIFT_AFTER_SECONDS).filter(point => point.value >= 1);
    const ended = input.drift.some(point => point.t > end);
    if (!ended || late.length === 0) return { id : "drift", state : pending(input, false) };
    return { id : "drift", state : "measured", valueMs : late.reduce((sum, point) => sum + point.value, 0), windows : late.length };
}

function workerReading(input : BlockReadingsInput) : BlockReading {
    if (!input.workerRunning) return { id : "worker", state : "unsupported" };
    const { start, end } = input.load;
    const waits = inRange(input.workerWaits, start, end + WORKER_AFTER_SECONDS);
    if (waits.length === 0) return { id : "worker", state : pending(input, input.workerWaits.some(point => point.t > end + WORKER_AFTER_SECONDS)) };
    return {
        id : "worker",
        state : "measured",
        valueMs : Math.max(...waits.map(point => point.value)),
        heartbeats : waits.filter(point => point.value >= WAITED_MS).length,
    };
}

function framesReading(input : BlockReadingsInput) : BlockReading {
    const { start, end } = input.load;
    const deltas = inRange(input.frameDeltas, start, end + FRAME_AFTER_SECONDS);
    if (!input.frameDeltas.some(point => point.t > end) || deltas.length === 0) return { id : "frames", state : pending(input, false) };
    const gap = Math.max(...deltas.map(point => point.value));
    const interval = frameInterval(input.frameDeltas, start);
    return { id : "frames", state : "measured", valueMs : gap, dropped : Math.max(0, Math.round(gap / interval) - 1) };
}

function loafReading(input : BlockReadingsInput) : BlockReading {
    if (!input.support.longAnimationFrame) return { id : "loaf", state : "unsupported" };
    const { start, end } = input.load;
    const frames = input.longFrames.filter(frame => frame.end >= start - 0.02 && frame.start <= end + 0.02);
    if (frames.length === 0) return { id : "loaf", state : pending(input, false) };
    const longest = frames.reduce((best, frame) => (frame.durationMs > best.durationMs ? frame : best));
    return { id : "loaf", state : "measured", valueMs : longest.durationMs, blockingMs : longest.blockingMs };
}

function eventReading(input : BlockReadingsInput) : BlockReading {
    if (!input.support.eventTiming) return { id : "event", state : "unsupported" };
    const { start } = input.load;
    const candidates = input.interactions.filter(item => item.start >= start - CLICK_BEFORE_SECONDS && item.start <= start + CLICK_AFTER_SECONDS);
    const click = candidates.at(-1);
    if (!click) return { id : "event", state : pending(input, false) };
    return {
        id : "event",
        state : "measured",
        valueMs : click.durationMs,
        inputDelayMs : click.inputDelayMs,
        processingMs : click.processingMs,
        presentationMs : click.presentationMs,
        rating : click.rating,
    };
}

/** The readings of the five monitors for one load, in a fixed sequence. */
export function blockReadings(input : BlockReadingsInput) : BlockReading[] {
    return [driftReading(input), workerReading(input), framesReading(input), loafReading(input), eventReading(input)];
}

/** The newest completed load of the snapshot, or `undefined`. A load that the reader stopped has no readings. */
export function lastLoad(snapshot : PlaygroundSnapshot) : MeasuredLoad | undefined {
    const record = snapshot.history[0];
    if (!record || record.aborted || record.kind !== "action") return undefined;
    return { id : record.id, start : record.startedAt, end : record.startedAt + record.durationMs / 1000, durationMs : record.durationMs };
}

export type BlockReport = { readonly load : MeasuredLoad; readonly readings : readonly BlockReading[] };

/**
 * The series of the session keep only the last seconds. Thus a value can
 * leave the series after the monitor measured it, first the samples of the
 * block and then the samples after it. Each value is a maximum or a sum
 * over the samples of the load: new samples make it larger, and lost
 * samples make it smaller. Thus this function keeps the larger value of the
 * previous report of the same load.
 */
export function keepMeasured(previous : BlockReport | undefined, next : BlockReport | undefined) : BlockReport | undefined {
    if (!previous || !next || previous.load.start !== next.load.start || previous.load.id !== next.load.id) return next;
    return {
        load : next.load,
        readings : next.readings.map((reading, index) => {
            const before = previous.readings[index];
            if (before?.state !== "measured") return reading;
            if (reading.state !== "measured" || (reading.valueMs ?? 0) < (before.valueMs ?? 0)) return before;
            return reading;
        }),
    };
}

/** The readings of the newest load of the snapshot, or `undefined` before the first load. */
export function snapshotReadings(snapshot : PlaygroundSnapshot) : BlockReport | undefined {
    const load = lastLoad(snapshot);
    if (!load) return undefined;
    const { timeline, series } = snapshot;
    return {
        load,
        readings : blockReadings({
            load,
            now : snapshot.elapsedSeconds,
            drift : timeline.drift,
            workerWaits : series.workerBlock.points,
            frameDeltas : series.frameDelta.points,
            longFrames : timeline.frames,
            interactions : timeline.interactions,
            workerRunning : snapshot.workerRunning,
            support : timeline.support,
        }),
    };
}
