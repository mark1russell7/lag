import type { Clock, Logger } from "./types.js";

/**
 * Page lifecycle states per the Page Lifecycle API.
 * See: https://developer.chrome.com/docs/web-platform/page-lifecycle-api
 *
 *   active  ⇄ passive              focus / blur
 *   active|passive → hidden        visibilitychange
 *   hidden  → active|passive       visibilitychange
 *   hidden  ⇄ frozen               freeze / resume
 *   any     → frozen               pagehide (persisted: entering the BFCache)
 *   frozen  → active|passive       pageshow (persisted: restored from the BFCache)
 *   any     → terminated           pagehide (not persisted)
 *
 * "discarded" is not modelled: a discarded page runs no script, so it can
 * only be detected after the reload, via `document.wasDiscarded`.
 */
export type LifecycleState =
    | "active"
    | "passive"
    | "hidden"
    | "frozen"
    | "terminated";

export type LifecycleTrigger =
    | "focus"
    | "blur"
    | "visibilitychange"
    | "freeze"
    | "resume"
    | "pagehide"
    | "pageshow";

export type StateTransition = {
    from : LifecycleState;
    to : LifecycleState;
    trigger : LifecycleTrigger;
    timestamp : number;
};

export type LifecycleMark = {
    readonly id : symbol;
};

/** Event objects are only read for `persisted` (pagehide/pageshow). */
export type LifecycleListener = (event : unknown) => void;

export type LifecycleEventTarget = {
    addEventListener(type : string, listener : LifecycleListener) : void;
    removeEventListener(type : string, listener : LifecycleListener) : void;
};

export type LifecycleDocument = LifecycleEventTarget & {
    visibilityState : string;
    hasFocus? : () => boolean;
};

export type LifecycleWindow = LifecycleEventTarget;

/**
 * A per-consumer "was the page hidden?" flag. Each gate tracks its own
 * window, so several monitors can share one state machine without consuming
 * each other's signal.
 */
export type HiddenGate = {
    /**
     * True if the page is, or at any point since the previous call (or since
     * the gate was created) was, hidden, frozen or terminated. Measurements
     * covering that span are unreliable: timers are throttled or suspended.
     */
    wasHiddenSinceLastCheck() : boolean;
    dispose() : void;
};

/** States in which the page is shown and timers run normally. */
export function isVisibleState(state : LifecycleState) : boolean {
    return state === "active" || state === "passive";
}

function isPersisted(event : unknown) : boolean {
    return (event as { persisted? : unknown } | undefined)?.persisted === true;
}

/**
 * Tracks page lifecycle state transitions and provides:
 * - a mark/resolve API to ask "what state changes happened between point A
 *   and now?"
 * - per-consumer hidden gates for discarding unreliable measurements
 * - change subscriptions, e.g. to pause monitors while the page is hidden
 *
 * Transitions are buffered only while a mark is outstanding, and those older
 * than the earliest unresolved mark are compacted away on each resolve() —
 * so resolve or cancel every mark. Hidden gates and subscriptions don't use
 * marks and keep O(1) state.
 */
export class LifecycleStateMachine {
    private currentState : LifecycleState;
    private transitions : StateTransition[] = [];
    private readonly marks = new Map<symbol, number>(); // mark id -> index into transitions
    private readonly subscribers = new Set<(transition : StateTransition) => void>();
    private readonly attached : Array<{ target : LifecycleEventTarget; type : string; listener : LifecycleListener }> = [];
    private totalTransitions = 0;

    constructor(
        private readonly document : LifecycleDocument,
        private readonly window : LifecycleWindow,
        private readonly clock : Clock,
        private readonly logger : Logger,
    ) {
        this.currentState = this.document.visibilityState === "hidden" ? "hidden" : this.visibleState();
        this.attachListeners();
    }

    /**
     * Returns the current lifecycle state.
     *
     * `document.visibilityState` updates synchronously but `visibilitychange`
     * is dispatched as a separate task, so a timer callback can run in
     * between. Every read re-syncs from `visibilityState` so such a callback
     * still sees the page as hidden.
     */
    getState() : LifecycleState {
        this.syncFromDocument();
        return this.currentState;
    }

    /**
     * Place a mark at the current point in the transition stream.
     * Call resolve(mark) later to get all transitions that occurred after.
     */
    mark() : LifecycleMark {
        this.syncFromDocument();
        const id = Symbol();
        this.marks.set(id, this.transitions.length);
        return { id };
    }

    /**
     * Get all transitions that have occurred since the mark, then drop the mark.
     * Returns an empty array if the mark is unknown (e.g. already resolved).
     */
    resolve(mark : LifecycleMark) : StateTransition[] {
        this.syncFromDocument();

        const startIdx = this.marks.get(mark.id);
        if (startIdx === undefined) return [];

        const result = this.transitions.slice(startIdx);
        this.marks.delete(mark.id);
        this.compact();
        return result;
    }

    /**
     * Drop a mark without retrieving its transitions. Use to abandon a mark
     * (e.g. the tracking session ended without needing the data).
     */
    cancel(mark : LifecycleMark) : void {
        if (this.marks.delete(mark.id)) {
            this.compact();
        }
    }

    createHiddenGate() : HiddenGate {
        // True if the current window started hidden or has seen a hidden state since
        let hidden = !isVisibleState(this.getState());
        let disposed = false;
        const unsubscribe = this.subscribe(({ to }) => {
            if (!isVisibleState(to)) hidden = true;
        });
        return {
            wasHiddenSinceLastCheck : () => {
                if (disposed) return false;
                const visibleNow = isVisibleState(this.getState());
                const result = hidden || !visibleNow;
                hidden = !visibleNow; // the next window starts in the current state
                return result;
            },
            dispose : () => {
                disposed = true;
                unsubscribe();
            },
        };
    }

    /** Call `listener` on every transition. Returns an unsubscribe function. */
    subscribe(listener : (transition : StateTransition) => void) : () => void {
        this.subscribers.add(listener);
        return () => { this.subscribers.delete(listener); };
    }

    /** Detach all DOM listeners and drop all marks and subscribers. */
    dispose() : void {
        for (const { target, type, listener } of this.attached) {
            target.removeEventListener(type, listener);
        }
        this.attached.length = 0;
        this.subscribers.clear();
        this.marks.clear();
        this.transitions = [];
    }

    /** Number of transitions currently buffered (for debugging/testing). */
    getBufferedCount() : number {
        return this.transitions.length;
    }

    /** Number of outstanding (unresolved) marks. */
    getMarkCount() : number {
        return this.marks.size;
    }

    /** Total number of transitions seen since startup (lifetime counter). */
    getTotalTransitions() : number {
        return this.totalTransitions;
    }

    private compact() : void {
        if (this.marks.size === 0) {
            this.transitions = [];
            return;
        }

        let earliest = Infinity;
        for (const idx of this.marks.values()) {
            if (idx < earliest) earliest = idx;
        }

        if (earliest > 0) {
            this.transitions = this.transitions.slice(earliest);
            for (const [id, idx] of this.marks) {
                this.marks.set(id, idx - earliest);
            }
        }
    }

    private syncFromDocument() : void {
        if (this.document.visibilityState === "hidden") {
            if (isVisibleState(this.currentState)) {
                this.transition("hidden", "visibilitychange");
            }
        } else if (this.currentState === "hidden") {
            this.transition(this.visibleState(), "visibilitychange");
        }
    }

    private visibleState() : LifecycleState {
        const focused = this.document.hasFocus ? this.document.hasFocus() : true;
        return focused ? "active" : "passive";
    }

    private transition(to : LifecycleState, trigger : LifecycleTrigger) : void {
        if (to === this.currentState) return;
        const transition : StateTransition = {
            from : this.currentState,
            to,
            trigger,
            timestamp : this.clock.now(),
        };
        this.currentState = to;
        this.totalTransitions++;
        // Nobody can resolve these later; don't buffer them
        if (this.marks.size > 0) {
            this.transitions.push(transition);
        }
        for (const subscriber of this.subscribers) {
            try {
                subscriber(transition);
            } catch (error) {
                this.logger.log("error", "Error in lifecycle subscriber.", {
                    error,
                    type : "LifecycleStateMachine",
                });
            }
        }
    }

    private listen(target : LifecycleEventTarget, type : string, listener : LifecycleListener) : void {
        target.addEventListener(type, listener);
        this.attached.push({ target, type, listener });
    }

    private attachListeners() : void {
        this.listen(this.window, "focus", () => {
            if (this.currentState === "passive") this.transition("active", "focus");
        });
        this.listen(this.window, "blur", () => {
            if (this.currentState === "active") this.transition("passive", "blur");
        });

        this.listen(this.document, "visibilitychange", () => this.syncFromDocument());

        this.listen(this.document, "freeze", () => this.transition("frozen", "freeze"));
        this.listen(this.document, "resume", () => this.transition("hidden", "resume"));

        this.listen(this.window, "pagehide", (event) => {
            this.transition(isPersisted(event) ? "frozen" : "terminated", "pagehide");
        });
        this.listen(this.window, "pageshow", (event) => {
            if (isPersisted(event)) this.transition(this.visibleState(), "pageshow");
        });
        // No beforeunload listener: it can be cancelled (leaving a live page
        // marked terminated) and it makes the page ineligible for the BFCache.
    }
}

/** Helper: extract a summary of state changes from a list of transitions. */
export type LifecycleSummary = {
    wasHidden : boolean;
    wasFrozen : boolean;
    wasTerminated : boolean;
    wasRestoredFromBFCache : boolean;
    wasFocused : boolean;
    wasBlurred : boolean;
    transitionCount : number;
};

export function summarizeTransitions(transitions : StateTransition[]) : LifecycleSummary {
    return {
        wasHidden : transitions.some(t => t.to === "hidden"),
        wasFrozen : transitions.some(t => t.to === "frozen"),
        wasTerminated : transitions.some(t => t.to === "terminated"),
        wasRestoredFromBFCache : transitions.some(t => t.trigger === "pageshow"),
        wasFocused : transitions.some(t => t.trigger === "focus"),
        wasBlurred : transitions.some(t => t.trigger === "blur"),
        transitionCount : transitions.length,
    };
}
