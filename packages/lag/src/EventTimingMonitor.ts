import { ObserverMonitor } from "./ObserverMonitor.js";
import { InpCalculator } from "./InpCalculator.js";
import type { PerformanceEntryLike, PerformanceObserverInit, EventTimingEntry } from "./perf-types.js";
import type { Logger } from "./types.js";

export type EventTimingReport = {
    duration : number;
    inputDelay : number;
    processingDuration : number;
    presentationDelay : number;
    interactionId : number;
    name : string;
    startTime : number;
    /** The DOM node of the event target, if the browser exposes it. */
    target : unknown;
};

/**
 * The browser default (104ms) would hide most interactions, skewing both the
 * per-event histograms and the INP calculation. 16ms is the minimum the spec
 * allows.
 */
const DURATION_THRESHOLD_MS = 16;

/**
 * Observes Event Timing entries for user interactions and calculates the
 * page-lifetime INP. Pass `readInteractionCount` (for example
 * `() => performance.interactionCount`) where the browser supports it.
 */
export class EventTimingMonitor extends ObserverMonitor {
    private readonly inp : InpCalculator;

    constructor(
        private readonly report : (entry : EventTimingReport) => void,
        logger : Logger,
        PerformanceObserverCtor : PerformanceObserverInit,
        readInteractionCount? : () => number | undefined,
    ) {
        super("event", logger, PerformanceObserverCtor, { durationThreshold : DURATION_THRESHOLD_MS });
        this.inp = new InpCalculator(readInteractionCount);
    }

    protected processEntry(entry : PerformanceEntryLike) : void {
        const event = entry as EventTimingEntry & { target? : unknown };

        // Only user interactions carry an interactionId (0 for other events)
        if (!event.interactionId) {
            return;
        }
        this.inp.add(event.interactionId, event.duration);

        const inputDelay = event.processingStart - event.startTime;
        const processingDuration = event.processingEnd - event.processingStart;
        // `duration` is rounded to 8ms, so this can come out slightly negative
        const presentationDelay = Math.max(0, event.duration - (event.processingEnd - event.startTime));

        this.report({
            duration : event.duration,
            inputDelay,
            processingDuration,
            presentationDelay,
            interactionId : event.interactionId,
            name : event.name,
            startTime : event.startTime,
            target : event.target,
        });
    }

    getWorstInteractionDuration() : number {
        return this.inp.getLongestDuration();
    }

    /** INP for the page lifetime since the monitor started. */
    getINP() : number {
        return this.inp.getINP();
    }

    getInteractionCount() : number {
        return this.inp.getInteractionCount();
    }

    override stop() : void {
        super.stop();
        // A restart reads the browser's buffered entries again, so start clean
        this.inp.reset();
    }
}

/** Maps an event type to the low-cardinality `interaction` metric attribute. */
export function interactionType(eventName : string) : "pointer" | "keyboard" | "other" {
    if (eventName.startsWith("key")) return "keyboard";
    if (eventName.startsWith("pointer") || eventName.startsWith("mouse") || eventName === "click"
        || eventName === "auxclick" || eventName === "contextmenu" || eventName.startsWith("touch")) {
        return "pointer";
    }
    return "other";
}
