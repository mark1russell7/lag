import type {
    AttributeValue,
    EntrySupport,
    InteractionType,
    RecordedInteractionEvent,
    TimelineNames,
    Rating,
    VitalName,
    VitalReading,
} from "../../adapters/lag-core";
import type { RecordedEvent, RecordedSpan, RecorderContents } from "./recorder";

/**
 * The data of the session timeline. All times are seconds since the start
 * of the session. A time before the start (for example the start of the
 * page view, or the FCP of the load) is negative. All lists are sorted by
 * their start time.
 */

export type TimelineAttributes = Readonly<Record<string, AttributeValue>>;

export type { Rating };

/** A value of a series of the meter. */
export type TimedValue = {
    readonly t : number;
    readonly value : number;
};

/** A span of the monitors. An open span ends at the present time. */
export type SpanItem = {
    readonly id : string;
    readonly name : string;
    readonly start : number;
    readonly end : number;
    readonly open : boolean;
    readonly attributes : TimelineAttributes;
};

/** A period with one state, for example the lifecycle state "active". */
export type StateSegment = {
    readonly start : number;
    readonly end : number;
    readonly state : string;
    /** The browser event that started the period, if the timeline knows it. */
    readonly trigger : string | undefined;
    /** For a compute pressure state: the source, for example "cpu". */
    readonly source? : string;
    /** True for the last period: it continues at the present time. */
    readonly open : boolean;
};

export type FrameItem = {
    readonly start : number;
    readonly end : number;
    readonly durationMs : number;
    readonly blockingMs : number;
    readonly renderMs : number;
    readonly script : { readonly invoker : string; readonly invokerType : string; readonly durationMs : number } | undefined;
};

/** One user interaction: the Event Timing entries with the same interaction ID. */
export type InteractionItem = {
    readonly id : number;
    readonly start : number;
    readonly end : number;
    /** The longest duration of its entries, as INP uses it. */
    readonly durationMs : number;
    readonly type : InteractionType;
    /** The event types, for example "pointerdown" and "click". */
    readonly names : readonly string[];
    /** The parts of the longest entry. */
    readonly inputDelayMs : number;
    readonly processingMs : number;
    readonly presentationMs : number;
    readonly rating : Rating;
};

export type ShiftItem = {
    readonly t : number;
    readonly value : number;
};

export type VitalMark = {
    readonly name : VitalName;
    readonly t : number;
    readonly value : number;
    readonly rating : Rating;
};

/** A load that the playground made. An active load ends at the present time. */
export type LoadItem = {
    readonly start : number;
    readonly end : number;
    readonly label : string;
    readonly aborted : boolean;
    readonly active : boolean;
};

export type InpThresholds = {
    /** A value at or below `good` is good. */
    readonly good : number;
    /** A value above `poor` is poor. */
    readonly poor : number;
};

export type TimelineModel = {
    /** The present time of the session. */
    readonly now : number;
    /** The earliest time of an item, or 0. It is not earlier than `EARLIEST_START` at any time. */
    readonly start : number;
    readonly running : boolean;
    readonly support : EntrySupport;
    readonly inpThresholds : InpThresholds;
    readonly pageViews : readonly SpanItem[];
    readonly lifecycle : readonly StateSegment[];
    readonly pressure : readonly StateSegment[];
    readonly drift : readonly TimedValue[];
    readonly macrotask : readonly TimedValue[];
    readonly frames : readonly FrameItem[];
    readonly hangs : readonly SpanItem[];
    readonly stalls : readonly SpanItem[];
    readonly interactions : readonly InteractionItem[];
    readonly shifts : readonly ShiftItem[];
    readonly vitals : readonly VitalMark[];
    readonly loads : readonly LoadItem[];
};

/** A load of the session, in ms of the session clock. */
export type LoadRun = {
    readonly label : string;
    readonly start : number;
    /** The value is undefined while the load is active. */
    readonly end : number | undefined;
    readonly aborted : boolean;
};

/** What the timeline needs from the runtime: the names of the events and spans, and the INP thresholds. */
export type TimelineConfig = {
    readonly names : TimelineNames;
    readonly inpThresholds : InpThresholds;
};

/** The input of `buildTimelineModel`. The times are ms of the session clock. */
export type TimelineSource = {
    readonly startedAt : number;
    readonly now : number;
    readonly running : boolean;
    readonly config : TimelineConfig;
    readonly drift : readonly TimedValue[];
    readonly macrotask : readonly TimedValue[];
    readonly recorded : RecorderContents;
    readonly vitals : readonly VitalReading[];
    readonly loads : readonly LoadRun[];
    /** The lifecycle state at this time, for a session without transitions. */
    readonly lifecycleState : string | undefined;
    readonly support : EntrySupport;
};

/** The timeline shows at most 10 minutes before the start of the session. */
export const EARLIEST_START = -600;

const NO_SUPPORT : EntrySupport = { longAnimationFrame : false, eventTiming : false, layoutShift : false };

const DEFAULT_INP_THRESHOLDS : InpThresholds = { good : 200, poor : 500 };

export function rateDuration(durationMs : number, thresholds : InpThresholds) : Rating {
    if (durationMs <= thresholds.good) return "good";
    if (durationMs <= thresholds.poor) return "needs-improvement";
    return "poor";
}

const byStart = <T extends { start : number }>(a : T, b : T) : number => a.start - b.start;
const byTime = <T extends { t : number }>(a : T, b : T) : number => a.t - b.t;

function text(value : AttributeValue | undefined) : string | undefined {
    return value === undefined ? undefined : String(value);
}

function spanItems(spans : readonly RecordedSpan[], name : string, toSeconds : (ms : number) => number, now : number) : SpanItem[] {
    return spans
        .filter(span => span.name === name)
        .map(span => ({
            id : span.id,
            name : span.name,
            start : toSeconds(span.start),
            end : span.end === undefined ? now : toSeconds(span.end),
            open : span.end === undefined,
            attributes : span.attributes,
        }))
        .sort(byStart);
}

/**
 * The lifecycle periods from the transition events. The first period starts
 * at the start of the session. Its state is the `from` of the first
 * transition, or the state at this time when there are no transitions. A
 * transition to the same state (a restore from the back/forward cache)
 * starts no new period.
 */
export function lifecycleSegments(events : readonly RecordedEvent[], toSeconds : (ms : number) => number, now : number, currentState : string | undefined) : StateSegment[] {
    const transitions = [...events].sort((a, b) => a.time - b.time);
    const initial = text(transitions[0]?.attributes["from"]) ?? currentState;
    if (initial === undefined) return [];
    const segments : Array<{ start : number; state : string; trigger : string | undefined }> = [{ start : 0, state : initial, trigger : undefined }];
    for (const transition of transitions) {
        const to = text(transition.attributes["to"]);
        if (to === undefined || to === segments[segments.length - 1]!.state) continue;
        segments.push({ start : Math.max(0, toSeconds(transition.time)), state : to, trigger : text(transition.attributes["trigger"]) });
    }
    return segments.map((segment, index) => {
        const next = segments[index + 1];
        return { ...segment, end : next ? next.start : Math.max(segment.start, now), open : next === undefined };
    });
}

/** The compute pressure periods of each source, from the change events. A period starts at a change and ends at the next change of its source. */
export function pressureSegments(events : readonly RecordedEvent[], toSeconds : (ms : number) => number, now : number) : StateSegment[] {
    const bySource = new Map<string, RecordedEvent[]>();
    for (const event of events) {
        const source = text(event.attributes["source"]) ?? "cpu";
        const list = bySource.get(source) ?? [];
        list.push(event);
        bySource.set(source, list);
    }
    const segments : StateSegment[] = [];
    for (const [source, list] of bySource) {
        const sorted = [...list].sort((a, b) => a.time - b.time);
        sorted.forEach((event, index) => {
            const next = sorted[index + 1];
            const start = toSeconds(event.time);
            segments.push({
                start,
                end : next ? toSeconds(next.time) : Math.max(start, now),
                state : text(event.attributes["state"]) ?? "unknown",
                trigger : undefined,
                source,
                open : next === undefined,
            });
        });
    }
    return segments.sort(byStart);
}

/**
 * This function groups the Event Timing entries by interaction. The
 * duration of an interaction is the longest duration of its entries, as for
 * INP. Its end is the latest end of its entries.
 */
export function groupInteractions(
    events : readonly RecordedInteractionEvent[],
    toSeconds : (ms : number) => number,
    thresholds : InpThresholds,
) : InteractionItem[] {
    const groups = new Map<number, RecordedInteractionEvent[]>();
    for (const event of events) {
        const list = groups.get(event.interactionId) ?? [];
        list.push(event);
        groups.set(event.interactionId, list);
    }
    const items : InteractionItem[] = [];
    for (const [id, list] of groups) {
        const longest = list.reduce((best, event) => (event.duration > best.duration ? event : best));
        const startMs = Math.min(...list.map(event => event.startTime));
        const endMs = Math.max(...list.map(event => event.startTime + event.duration));
        items.push({
            id,
            start : toSeconds(startMs),
            end : toSeconds(endMs),
            durationMs : longest.duration,
            type : longest.type,
            names : [...new Set(list.map(event => event.name))],
            inputDelayMs : longest.inputDelay,
            processingMs : longest.processingDuration,
            presentationMs : longest.presentationDelay,
            rating : rateDuration(longest.duration, thresholds),
        });
    }
    return items.sort(byStart);
}

/** The nominal length of a DriftLag window without lag, in seconds. */
export const DRIFT_WINDOW_SECONDS = 0.1;

/**
 * The measurement conditions keep a sample of 5 s or more for some time
 * before they record it, because they look for evidence of a suspend. Thus
 * the meter has the time of the record, not the end of the window.
 *
 * The DriftLag windows follow each other, thus a long window fills a gap of
 * its length in the series. This function finds each long value (1 s or more)
 * that does not follow such a gap. It moves the value to the latest earlier
 * gap that is long enough for it, and that no other value uses. There, the
 * window ends where the next window starts. The result is sorted by time.
 */
export function placeLateWindows(points : readonly TimedValue[], minimumSeconds = 1, windowSeconds = DRIFT_WINDOW_SECONDS) : TimedValue[] {
    const times = points.map(point => point.t);
    const used = new Set<number>();
    const placed = points.map((point, index) => {
        const length = point.value / 1000;
        if (length < minimumSeconds || index === 0) return point;
        if (times[index]! - times[index - 1]! >= length) {
            used.add(index);
            return point;
        }
        for (let gap = index - 1; gap >= 1; gap--) {
            if (times[index]! - times[gap]! > length + 10) break;
            if (used.has(gap) || times[gap]! - times[gap - 1]! < length) continue;
            used.add(gap);
            const next = points[gap]!;
            const end = next.t - windowSeconds - Math.max(0, next.value) / 1000;
            return { t : Math.max(times[gap - 1]! + length, end), value : point.value };
        }
        return point;
    });
    return placed.sort((a, b) => a.t - b.t);
}

/**
 * This function makes the timeline model from what the session recorded. It
 * is a pure function: the same source gives the same model.
 */
export function buildTimelineModel(source : TimelineSource) : TimelineModel {
    const toSeconds = (ms : number) : number => (ms - source.startedAt) / 1000;
    const now = toSeconds(source.now);
    const { names, inpThresholds } = source.config;
    const { events, spans } = source.recorded;
    const inRange = <T extends { t : number }>(item : T) : boolean => item.t >= EARLIEST_START;

    const frames = source.recorded.frames.map(frame => {
        const start = toSeconds(frame.startTime);
        return {
            start,
            end : start + frame.duration / 1000,
            durationMs : frame.duration,
            blockingMs : frame.blockingDuration,
            renderMs : frame.renderDuration,
            script : frame.script ? { invoker : frame.script.invoker, invokerType : frame.script.invokerType, durationMs : frame.script.duration } : undefined,
        };
    }).filter(frame => frame.end >= EARLIEST_START).sort(byStart);

    const vitals = source.vitals
        .filter((vital) : vital is VitalReading & { time : number } => vital.time !== undefined && Number.isFinite(vital.time))
        .map(vital => ({
            name : vital.name,
            t : toSeconds(vital.time),
            value : vital.value,
            rating : vital.rating,
        }))
        .filter(inRange)
        .sort(byTime);

    const model = {
        now,
        running : source.running,
        support : source.support,
        inpThresholds,
        pageViews : spanItems(spans, names.pageView, toSeconds, now).filter(span => span.end >= EARLIEST_START),
        lifecycle : lifecycleSegments(events.filter(event => event.name === names.lifecycleTransition), toSeconds, now, source.lifecycleState),
        pressure : pressureSegments(events.filter(event => event.name === names.pressureChange), toSeconds, now),
        drift : placeLateWindows(source.drift.map(point => ({ t : toSeconds(point.t), value : point.value }))),
        macrotask : source.macrotask.map(point => ({ t : toSeconds(point.t), value : point.value })),
        frames,
        hangs : spanItems(spans, names.hang, toSeconds, now).filter(span => span.end >= EARLIEST_START),
        stalls : spanItems(spans, names.stall, toSeconds, now).filter(span => span.end >= EARLIEST_START),
        interactions : groupInteractions(source.recorded.interactions, toSeconds, inpThresholds).filter(item => item.end >= EARLIEST_START),
        shifts : source.recorded.shifts.map(shift => ({ t : toSeconds(shift.startTime), value : shift.value })).filter(inRange).sort(byTime),
        vitals,
        loads : source.loads.map(load => ({
            start : toSeconds(load.start),
            end : load.end === undefined ? now : toSeconds(load.end),
            label : load.label,
            aborted : load.aborted,
            active : load.end === undefined,
        })).sort(byStart),
    };
    return { ...model, start : earliestStart(model) };
}

function earliestStart(model : Omit<TimelineModel, "start">) : number {
    let start = 0;
    const consider = (time : number | undefined) : void => {
        if (time !== undefined && time < start) start = time;
    };
    consider(model.pageViews[0]?.start);
    consider(model.frames[0]?.start);
    consider(model.interactions[0]?.start);
    consider(model.shifts[0]?.t);
    consider(model.vitals[0]?.t);
    consider(model.hangs[0]?.start);
    consider(model.stalls[0]?.start);
    return Math.max(EARLIEST_START, start);
}

/** A model without data, for a session that did not start. */
export const EMPTY_TIMELINE : TimelineModel = {
    now : 0,
    start : 0,
    running : false,
    support : NO_SUPPORT,
    inpThresholds : DEFAULT_INP_THRESHOLDS,
    pageViews : [],
    lifecycle : [],
    pressure : [],
    drift : [],
    macrotask : [],
    frames : [],
    hangs : [],
    stalls : [],
    interactions : [],
    shifts : [],
    vitals : [],
    loads : [],
};
