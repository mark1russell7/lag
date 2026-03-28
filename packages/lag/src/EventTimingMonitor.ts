import { ObserverMonitor } from "./ObserverMonitor.js";
import type { PerformanceEntryLike, PerformanceObserverInit, EventTimingEntry } from "./perf-types.js";
import type { Logger } from "./types.js";

export type EventTimingReport = {
    duration : number;
    inputDelay : number;
    processingDuration : number;
    presentationDelay : number;
    interactionId : number;
    name : string;
};

export class EventTimingMonitor extends ObserverMonitor {
    private interactions = new Map<number, number>();
    private worstDuration = 0;

    constructor(
        private readonly report : (entry : EventTimingReport) => void,
        logger : Logger,
        PerformanceObserverCtor : PerformanceObserverInit,
    ) {
        super("event", logger, PerformanceObserverCtor);
    }

    protected processEntry(entry : PerformanceEntryLike) : void {
        const event = entry as EventTimingEntry;

        // Only process actual user interactions (not synthetic events)
        if (!event.interactionId || event.interactionId === 0) {
            return;
        }

        const inputDelay = event.processingStart - event.startTime;
        const processingDuration = event.processingEnd - event.processingStart;
        const presentationDelay = event.duration - (event.processingEnd - event.startTime);

        // Track worst duration per interaction (multiple events per interaction)
        const existing = this.interactions.get(event.interactionId);
        if (existing === undefined || event.duration > existing) {
            this.interactions.set(event.interactionId, event.duration);
        }

        if (event.duration > this.worstDuration) {
            this.worstDuration = event.duration;
        }

        this.report({
            duration : event.duration,
            inputDelay,
            processingDuration,
            presentationDelay,
            interactionId : event.interactionId,
            name : event.name,
        });
    }

    getWorstInteractionDuration() : number {
        return this.worstDuration;
    }

    getINP() : number {
        if (this.interactions.size === 0) {
            return 0;
        }
        // INP is the p98 of interaction durations
        const durations = [...this.interactions.values()].sort((a, b) => a - b);
        const p98Index = Math.max(0, Math.ceil(durations.length * 0.98) - 1);
        return durations[p98Index]!;
    }

    override stop() : void {
        super.stop();
        this.interactions.clear();
        this.worstDuration = 0;
    }
}
