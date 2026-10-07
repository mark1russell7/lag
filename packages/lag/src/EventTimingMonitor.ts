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

/**
 * The browser default (104ms) would hide most interactions, skewing both the
 * per-event histograms and the interaction count INP depends on. 16ms is the
 * minimum the spec allows.
 */
const DURATION_THRESHOLD_MS = 16;

/** INP never needs more than this many of the longest interactions (as in web-vitals). */
const MAX_TRACKED_INTERACTIONS = 10;

/** INP ignores one outlier per this many interactions. */
const INTERACTIONS_PER_OUTLIER = 50;

/**
 * Chromium increments interactionId by 7 per interaction, so the ID span
 * also counts the fast interactions that produce no entry (as web-vitals'
 * interactionCount polyfill does).
 */
const INTERACTION_ID_STEP = 7;

type Interaction = { id : number; duration : number };

export class EventTimingMonitor extends ObserverMonitor {
    /** Longest interactions, sorted by duration descending. */
    private longest : Interaction[] = [];
    /** Interactions seen in entries (a lower bound: fast ones produce none). */
    private observedInteractions = 0;
    private minInteractionId = Infinity;
    private maxInteractionId = 0;

    constructor(
        private readonly report : (entry : EventTimingReport) => void,
        logger : Logger,
        PerformanceObserverCtor : PerformanceObserverInit,
    ) {
        super("event", logger, PerformanceObserverCtor, { durationThreshold : DURATION_THRESHOLD_MS });
    }

    protected processEntry(entry : PerformanceEntryLike) : void {
        const event = entry as EventTimingEntry;

        // Only user interactions carry an interactionId (0 for other events)
        if (!event.interactionId) {
            return;
        }

        // Interaction IDs increase monotonically; several events (pointerdown,
        // pointerup, click) share one ID.
        if (event.interactionId > this.maxInteractionId) {
            this.maxInteractionId = event.interactionId;
            this.observedInteractions++;
        }
        this.minInteractionId = Math.min(this.minInteractionId, event.interactionId);
        this.trackInteraction(event.interactionId, event.duration);

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
        });
    }

    getWorstInteractionDuration() : number {
        return this.longest[0]?.duration ?? 0;
    }

    /**
     * Interaction to Next Paint: the longest interaction, ignoring one outlier
     * for every 50 interactions (≈ p98 for busy pages).
     */
    getINP() : number {
        if (this.longest.length === 0) {
            return 0;
        }
        const index = Math.min(
            this.longest.length - 1,
            Math.floor(this.getInteractionCount() / INTERACTIONS_PER_OUTLIER),
        );
        return this.longest[index]!.duration;
    }

    /** Estimated number of interactions so far, including those too fast to produce an entry. */
    getInteractionCount() : number {
        if (this.observedInteractions === 0) return 0;
        const fromIdSpan = Math.floor((this.maxInteractionId - this.minInteractionId) / INTERACTION_ID_STEP) + 1;
        return Math.max(this.observedInteractions, fromIdSpan);
    }

    override stop() : void {
        super.stop();
        // A restart re-reads the browser's buffered entries, so start clean
        this.longest = [];
        this.observedInteractions = 0;
        this.minInteractionId = Infinity;
        this.maxInteractionId = 0;
    }

    private trackInteraction(id : number, duration : number) : void {
        const existing = this.longest.find(i => i.id === id);
        if (existing) {
            if (duration <= existing.duration) return;
            existing.duration = duration;
        } else {
            const shortest = this.longest[this.longest.length - 1];
            if (this.longest.length >= MAX_TRACKED_INTERACTIONS && shortest && duration <= shortest.duration) {
                return;
            }
            this.longest.push({ id, duration });
        }
        this.longest.sort((a, b) => b.duration - a.duration);
        this.longest.length = Math.min(this.longest.length, MAX_TRACKED_INTERACTIONS);
    }
}
