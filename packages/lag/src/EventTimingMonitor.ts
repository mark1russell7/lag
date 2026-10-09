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
 * The browser default (104 ms) hides most interactions. Thus, it gives a
 * bias to the histograms of the events and to the INP calculation. 16 ms is
 * the minimum that the specification permits.
 */
const DURATION_THRESHOLD_MS = 16;

/**
 * This monitor observes the Event Timing entries of user interactions, and
 * it calculates the INP for the lifetime of the page. Give
 * `readInteractionCount` (for example `() => performance.interactionCount`)
 * when the browser supports it.
 *
 * The observer gets the buffered entries from before the start of the
 * monitor. Thus the interaction count also starts at the start of the page,
 * as for the load in web-vitals.
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
        this.inp = new InpCalculator(readInteractionCount, 0);
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

    /** The INP for the lifetime of the page, from the start of the page. */
    getINP() : number {
        return this.inp.getINP();
    }

    getInteractionCount() : number {
        return this.inp.getInteractionCount();
    }

    override stop() : void {
        super.stop();
        // A restart reads the browser's buffered entries again, so start clean, with the count from the start of the page
        this.inp.reset(0);
    }
}

/**
 * This function maps an event type to a value of the `interaction` metric
 * attribute. The attribute has a low cardinality.
 */
export function interactionType(eventName : string) : "pointer" | "keyboard" | "other" {
    if (eventName.startsWith("key")) return "keyboard";
    if (eventName.startsWith("pointer") || eventName.startsWith("mouse") || eventName === "click"
        || eventName === "auxclick" || eventName === "contextmenu" || eventName.startsWith("touch")) {
        return "pointer";
    }
    return "other";
}
