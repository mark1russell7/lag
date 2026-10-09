/** INP uses no more than this number of the longest interactions (as in web-vitals). */
const MAX_TRACKED_INTERACTIONS = 10;

/** INP ignores one outlier for each 50 interactions. */
const INTERACTIONS_PER_OUTLIER = 50;

type Interaction = { id : number; duration : number };

/**
 * This class calculates Interaction to Next Paint (INP) from Event Timing
 * entries.
 *
 * INP is the longest interaction, but the calculation ignores one outlier
 * for each 50 interactions. The calculator keeps only the 10 longest
 * interactions. Some events share one `interactionId`, for example
 * `pointerdown`, `pointerup` and `click`. The longest of these events counts.
 *
 * The number of interactions comes from `readInteractionCount` when the
 * browser gives it (`performance.interactionCount`). If not, the calculator
 * counts the interactions that it saw. That count is a lower bound, because
 * fast interactions make no entry. Thus, INP can be a little too high for
 * pages with many fast interactions.
 */
export class InpCalculator {
    /** The longest interactions, sorted by duration, longest first. */
    private longest : Interaction[] = [];
    private observedInteractions = 0;
    private maxInteractionId = 0;
    private interactionCountAtStart : number;

    constructor(
        private readonly readInteractionCount? : () => number | undefined,
        /** The interaction count at the start. The default is the count at this time. */
        baseline? : number,
    ) {
        this.interactionCountAtStart = baseline ?? readInteractionCount?.() ?? 0;
    }

    /** This method adds one Event Timing entry. It ignores an entry without an `interactionId`. */
    add(interactionId : number, duration : number) : void {
        if (!interactionId) return;
        // Interaction IDs increase monotonically
        if (interactionId > this.maxInteractionId) {
            this.maxInteractionId = interactionId;
            this.observedInteractions++;
        }

        const existing = this.longest.find(i => i.id === interactionId);
        if (existing) {
            if (duration <= existing.duration) return;
            existing.duration = duration;
        } else {
            const shortest = this.longest[this.longest.length - 1];
            if (this.longest.length >= MAX_TRACKED_INTERACTIONS && shortest && duration <= shortest.duration) {
                return;
            }
            this.longest.push({ id : interactionId, duration });
        }
        this.longest.sort((a, b) => b.duration - a.duration);
        this.longest.length = Math.min(this.longest.length, MAX_TRACKED_INTERACTIONS);
    }

    /** The number of interactions since the start or the last reset. */
    getInteractionCount() : number {
        const fromBrowser = this.readInteractionCount?.();
        if (fromBrowser !== undefined && fromBrowser > 0) {
            return Math.max(this.observedInteractions, fromBrowser - this.interactionCountAtStart);
        }
        return this.observedInteractions;
    }

    /** The current INP in milliseconds, or 0 if there was no interaction. */
    getINP() : number {
        if (this.longest.length === 0) return 0;
        const index = Math.min(
            this.longest.length - 1,
            Math.floor(this.getInteractionCount() / INTERACTIONS_PER_OUTLIER),
        );
        return this.longest[index]!.duration;
    }

    /** The interaction ID of the interaction that `getINP()` gives, or 0. */
    getINPInteractionId() : number {
        if (this.longest.length === 0) return 0;
        const index = Math.min(
            this.longest.length - 1,
            Math.floor(this.getInteractionCount() / INTERACTIONS_PER_OUTLIER),
        );
        return this.longest[index]!.id;
    }

    getLongestDuration() : number {
        return this.longest[0]?.duration ?? 0;
    }

    /** True if the interaction is one of the longest interactions that the calculator keeps. */
    has(interactionId : number) : boolean {
        return this.longest.some(i => i.id === interactionId);
    }

    /**
     * This method starts a new calculation, for example for a new page view.
     * `baseline` is the interaction count at the new start. The default is
     * the count at this time.
     */
    reset(baseline? : number) : void {
        this.longest = [];
        this.observedInteractions = 0;
        this.maxInteractionId = 0;
        this.interactionCountAtStart = baseline ?? this.readInteractionCount?.() ?? 0;
    }
}
