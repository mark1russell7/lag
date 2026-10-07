import { InpCalculator } from "../InpCalculator.js";
import { ClsCalculator } from "../ClsCalculator.js";
import { interactionType } from "../EventTimingMonitor.js";
import type { NavigationType, VitalValue } from "./types.js";

/** One page view: a load, a restore from the back/forward cache, or a soft navigation. */
export type PageView = {
    readonly id : string;
    readonly navigationType : NavigationType;
    /** The start of the view in `performance.now()` time. */
    readonly startTime : number;
    /** For a soft navigation: the interaction that started it. */
    readonly interactionId? : number;
    /** The URL at the start of the view, without the query and the fragment. */
    readonly url? : string;
};

/** The Event Timing fields that the collector reads. */
export type EventEntryLike = {
    name : string;
    startTime : number;
    duration : number;
    processingStart : number;
    processingEnd : number;
    interactionId? : number;
    target? : unknown;
};

export type LayoutShiftEntryLike = {
    startTime : number;
    value : number;
    hadRecentInput : boolean;
    sources? : ReadonlyArray<{ node? : unknown }>;
};

/**
 * The events that the browser presented in one frame: the entries whose
 * render times (`startTime + duration`) are within `FRAME_GROUP_MS` of the
 * first entry of the group. The entries can belong to different
 * interactions, or to no interaction (for example `pointerover`).
 */
type FrameGroup = {
    readonly renderTime : number;
    processingStart : number;
    processingEnd : number;
};

/**
 * The facts of one Event Timing entry that the attribution uses. The
 * collector keeps the selector of the target, not the node, so that it keeps
 * no removed DOM node in memory.
 */
type EventFacts = {
    name : string;
    startTime : number;
    duration : number;
    target : string;
    /** The events of the frame of this entry. */
    frame : FrameGroup;
};

/**
 * The value of INP after a back/forward cache restore or a soft navigation,
 * when there were interactions but none had an entry. Entries come only for
 * interactions of 16 ms or more. The web-vitals library gives the same
 * value.
 */
export const SHORT_INTERACTION_ESTIMATE_MS = 8;

/** Entries whose render times are this close belong to one frame (as in web-vitals). */
const FRAME_GROUP_MS = 8;

/**
 * The collector looks for the frame of a new entry in this number of recent
 * frames. web-vitals keeps 10 or more recent frames, and the frames of its
 * candidates. Here, the facts of an INP candidate keep the group of their
 * frame.
 */
const MAX_RECENT_FRAMES = 50;

/** The collector keeps no more than this number of entries for one interaction. */
const MAX_ENTRIES_PER_INTERACTION = 16;

/**
 * This class collects the vitals of one page view. The page-view orchestrator
 * (`PageViewVitals`) gives the entries to the collector. The collector
 * applies the rules of the metrics, as web-vitals does:
 * - INP: the interactions from the start of the view. The `first-input`
 *   entry is a candidate also, because the browser always delivers it.
 * - CLS: the layout shifts without recent input. For a load, the collector
 *   reports CLS only after FCP.
 * - LCP, FCP, TTFB: the orchestrator sets them, because it knows the time base.
 */
export class ViewCollector {
    private readonly inp : InpCalculator;
    private readonly cls = new ClsCalculator();
    /** The entries of each INP candidate, keyed by interaction ID. */
    private readonly interactions = new Map<number, EventFacts[]>();
    private readonly recentFrames : FrameGroup[] = [];
    private clsReportable : boolean;
    private lcp : VitalValue | undefined;
    private fcp : number | undefined;
    private ttfb : number | undefined;
    private lcpFinalTime = Infinity;

    constructor(
        readonly view : PageView,
        private readonly describeNode : (node : unknown) => string,
        readInteractionCount? : () => number | undefined,
    ) {
        // As web-vitals: the load (the view that starts at 0) counts the interactions from the
        // start of the page, also when the monitors start later. A later view counts from its start.
        this.inp = new InpCalculator(readInteractionCount, view.startTime === 0 ? 0 : undefined);
        // As in CrUX: the CLS of a load counts only after the first contentful paint
        this.clsReportable = view.navigationType === "back-forward-cache" || view.navigationType === "soft-navigation";
    }

    /**
     * This method adds an `event` or a `first-input` entry. An entry without
     * an interaction is not an INP candidate, but its processing time counts
     * in the attribution of the interactions of its frame.
     */
    addEvent(entry : EventEntryLike) : void {
        if (entry.startTime < this.view.startTime) return;
        const frame = this.frameOf(entry);
        const id = entry.interactionId;
        if (!id) return;
        // As web-vitals: the interaction that started a soft navigation belongs to the view that ended,
        // also when the browser delivers one of its entries after the soft-navigation entry
        if (this.view.navigationType === "soft-navigation" && id === this.view.interactionId) return;
        this.inp.add(id, entry.duration);
        if (!this.inp.has(id)) return;

        // Keep all entries of a candidate: the attribution uses the longest one and its frame
        const kept = this.interactions.get(id) ?? [];
        if (kept.length < MAX_ENTRIES_PER_INTERACTION) kept.push(this.factsOf(entry, frame));
        this.interactions.set(id, kept);
        for (const known of this.interactions.keys()) {
            if (!this.inp.has(known)) this.interactions.delete(known);
        }
    }

    addLayoutShift(entry : LayoutShiftEntryLike) : void {
        if (entry.hadRecentInput || entry.startTime < this.view.startTime) return;
        this.cls.add(entry.startTime, entry.value, entry.sources ?? []);
    }

    setFcp(value : number) : void {
        if (this.fcp !== undefined) return;
        this.fcp = Math.max(0, value);
        this.clsReportable = true;
    }

    /**
     * This method sets the LCP. With `renderTime`, the method ignores a paint
     * after the time at which the LCP became final (`finalizeLcpAt`).
     */
    setLcp(value : number, attribution : Readonly<Record<string, string | number>> = {}, renderTime? : number) : void {
        if (renderTime !== undefined && renderTime > this.lcpFinalTime) return;
        this.lcp = { name : "LCP", value : Math.max(0, value), attribution };
    }

    /** This method makes the LCP final at `time`, the time of a user input: later paints do not change it. */
    finalizeLcpAt(time : number) : void {
        this.lcpFinalTime = Math.min(this.lcpFinalTime, time);
    }

    setTtfb(value : number) : void {
        this.ttfb = Math.max(0, value);
    }

    /** The values that are known at this time. The collector leaves out a vital that has no value, for example INP before the first interaction. */
    values() : VitalValue[] {
        const result : VitalValue[] = [];
        const inp = this.inpValue();
        if (inp) result.push(inp);
        if (this.clsReportable) result.push(this.clsValue());
        if (this.lcp) result.push(this.lcp);
        if (this.fcp !== undefined) result.push({ name : "FCP", value : this.fcp, attribution : {} });
        if (this.ttfb !== undefined) result.push({ name : "TTFB", value : this.ttfb, attribution : {} });
        return result;
    }

    private inpValue() : VitalValue | undefined {
        const value = this.inp.getINP();
        // A candidate can have the duration 0, as a first input that the browser rounds to 0
        if (this.inp.getINPInteractionId() !== 0) {
            const entries = this.interactions.get(this.inp.getINPInteractionId());
            return { name : "INP", value, attribution : entries ? interactionAttribution(entries, value) : {} };
        }
        const restored = this.view.navigationType === "back-forward-cache" || this.view.navigationType === "soft-navigation";
        if (restored && this.inp.getInteractionCount() > 0) {
            return { name : "INP", value : SHORT_INTERACTION_ESTIMATE_MS, attribution : {} };
        }
        return undefined;
    }

    private clsValue() : VitalValue {
        const sources = this.cls.getLargestShiftSources() as ReadonlyArray<{ node? : unknown }>;
        const node = sources.find(source => source.node !== undefined && source.node !== null)?.node;
        const target = node === undefined ? "" : this.describeNode(node);
        return { name : "CLS", value : this.cls.getCLS(), attribution : target ? { largest_shift_target : target } : {} };
    }

    /** This method adds the entry to the group of its frame, as web-vitals does. */
    private frameOf(entry : EventEntryLike) : FrameGroup {
        const renderTime = entry.startTime + entry.duration;
        for (let i = this.recentFrames.length - 1; i >= 0; i--) {
            const frame = this.recentFrames[i]!;
            if (Math.abs(renderTime - frame.renderTime) <= FRAME_GROUP_MS) {
                frame.processingStart = Math.min(frame.processingStart, entry.processingStart);
                frame.processingEnd = Math.max(frame.processingEnd, entry.processingEnd);
                return frame;
            }
        }
        const frame : FrameGroup = { renderTime, processingStart : entry.processingStart, processingEnd : entry.processingEnd };
        this.recentFrames.push(frame);
        if (this.recentFrames.length > MAX_RECENT_FRAMES) this.recentFrames.shift();
        return frame;
    }

    private factsOf(entry : EventEntryLike, frame : FrameGroup) : EventFacts {
        return {
            name : entry.name,
            startTime : entry.startTime,
            duration : entry.duration,
            target : entry.target === undefined || entry.target === null ? "" : this.describeNode(entry.target),
            frame,
        };
    }
}

/**
 * The INP attribution of one interaction, with the phase rules of the
 * web-vitals attribution build. The phases (input delay, processing
 * duration, presentation delay) add up to the time from the interaction to
 * the next paint.
 *
 * The longest entry of the interaction gives the latency and the start of
 * the interaction. The processing phase spans all events of the frame of
 * that entry, as in web-vitals. For example, a click has `pointerdown`,
 * `pointerup` and `click` entries that end at the same paint. `pointerdown`
 * is the longest, but the handler of `click` does the processing. The events
 * of other interactions and the events without an interaction in the frame
 * also count. The processing starts at the interaction at the earliest.
 *
 * The collector observes entries of 16 ms or more. The web-vitals library
 * observes entries of 40 ms or more by default. Thus a frame here can also
 * contain shorter events.
 */
function interactionAttribution(entries : readonly EventFacts[], latency : number) : Record<string, string | number> {
    const longest = entries.reduce((a, b) => (b.duration > a.duration ? b : a));
    const frame = longest.frame;
    const interactionTime = longest.startTime;
    const processingStart = Math.max(frame.processingStart, interactionTime);
    const nextPaintTime = Math.max(interactionTime + latency, processingStart);
    // A synchronous dialog (`alert()`) can end the processing after the next paint
    const processingEnd = Math.max(processingStart, Math.min(frame.processingEnd, nextPaintTime));
    const target = [longest, ...entries].find(e => e.target !== "")?.target ?? "";
    return {
        interaction_target : target,
        interaction_type : interactionType(longest.name),
        input_delay_ms : processingStart - interactionTime,
        processing_duration_ms : processingEnd - processingStart,
        presentation_delay_ms : nextPaintTime - processingEnd,
    };
}
