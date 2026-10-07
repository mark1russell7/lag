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
 * The facts of one Event Timing entry that the attribution uses. The
 * collector keeps the selector of the target, not the node, so that it keeps
 * no removed DOM node in memory.
 */
type EventFacts = {
    name : string;
    startTime : number;
    duration : number;
    processingStart : number;
    processingEnd : number;
    target : string;
};

/**
 * The value of INP after a back/forward cache restore or a soft navigation,
 * when there were interactions but none had an entry. Entries come only for
 * interactions of 16 ms or more. web-vitals gives the same value.
 */
export const SHORT_INTERACTION_ESTIMATE_MS = 8;

/**
 * Collects the vitals of one page view. The page-view orchestrator
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
    /** The longest entries of each INP candidate, keyed by interaction ID. */
    private readonly interactions = new Map<number, EventFacts[]>();
    private clsReportable : boolean;
    private lcp : VitalValue | undefined;
    private fcp : number | undefined;
    private ttfb : number | undefined;

    constructor(
        readonly view : PageView,
        private readonly describeNode : (node : unknown) => string,
        readInteractionCount? : () => number | undefined,
    ) {
        this.inp = new InpCalculator(readInteractionCount);
        // As in CrUX: the CLS of a load counts only after the first contentful paint
        this.clsReportable = view.navigationType === "back-forward-cache" || view.navigationType === "soft-navigation";
    }

    /** Adds an `event` or a `first-input` entry. */
    addEvent(entry : EventEntryLike) : void {
        const id = entry.interactionId;
        if (!id || entry.startTime < this.view.startTime) return;
        this.inp.add(id, entry.duration);
        if (!this.inp.has(id)) return;

        // Keep the entries with the longest duration, as web-vitals does
        const kept = this.interactions.get(id);
        if (!kept || entry.duration > kept[0]!.duration) {
            this.interactions.set(id, [this.factsOf(entry)]);
        } else if (entry.duration === kept[0]!.duration && entry.startTime === kept[0]!.startTime) {
            kept.push(this.factsOf(entry));
        }
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

    setLcp(value : number, attribution : Readonly<Record<string, string | number>> = {}) : void {
        this.lcp = { name : "LCP", value : Math.max(0, value), attribution };
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
        if (value > 0) {
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

    private factsOf(entry : EventEntryLike) : EventFacts {
        return {
            name : entry.name,
            startTime : entry.startTime,
            duration : entry.duration,
            processingStart : entry.processingStart,
            processingEnd : entry.processingEnd,
            target : entry.target === undefined || entry.target === null ? "" : this.describeNode(entry.target),
        };
    }
}

/**
 * The INP attribution of one interaction, with the phase rules of the
 * web-vitals attribution build. The phases (input delay, processing
 * duration, presentation delay) add up to the time from the interaction to
 * the next paint. web-vitals also adds the entries of other events in the
 * same frame. This collector uses only the entries of the interaction.
 */
function interactionAttribution(entries : readonly EventFacts[], latency : number) : Record<string, string | number> {
    const first = entries[0]!;
    const interactionTime = first.startTime;
    const processingStart = Math.max(Math.min(...entries.map(e => e.processingStart)), interactionTime);
    const nextPaintTime = Math.max(interactionTime + latency, processingStart);
    // A synchronous dialog (`alert()`) can end the processing after the next paint
    const processingEnd = Math.max(processingStart, Math.min(Math.max(...entries.map(e => e.processingEnd)), nextPaintTime));
    return {
        interaction_target : entries.find(e => e.target !== "")?.target ?? "",
        interaction_type : interactionType(first.name),
        input_delay_ms : processingStart - interactionTime,
        processing_duration_ms : processingEnd - processingStart,
        presentation_delay_ms : nextPaintTime - processingEnd,
    };
}
