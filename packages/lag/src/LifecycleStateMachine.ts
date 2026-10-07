import type { Clock, Logger } from "./types.js";

/**
 * The page lifecycle states of the Page Lifecycle API. Refer to
 * https://developer.chrome.com/docs/web-platform/page-lifecycle-api.
 *
 * The transitions and the events that cause them:
 *
 * ```text
 * active         ⇄ passive          focus / blur
 * active|passive → hidden           visibilitychange
 * hidden         → active|passive   visibilitychange
 * hidden         ⇄ frozen           freeze / resume
 * any            → frozen           pagehide (persisted: into the back/forward cache)
 * frozen         → active|passive   pageshow (persisted: from the back/forward cache)
 * any            → terminated       pagehide (not persisted)
 * ```
 *
 * The machine does not model the "discarded" state. No script operates in a
 * discarded page. Thus, the page can find a discard only after the reload,
 * through `document.wasDiscarded`.
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

/**
 * The machine reads only two properties of an event object: `persisted` (of
 * `pagehide` and `pageshow`) and `timeStamp`.
 */
export type LifecycleListener = (event : unknown) => void;

export type LifecycleListenerOptions = { capture? : boolean };

export type LifecycleEventTarget = {
    addEventListener(type : string, listener : LifecycleListener, options? : LifecycleListenerOptions) : void;
    removeEventListener(type : string, listener : LifecycleListener, options? : LifecycleListenerOptions) : void;
};

export type LifecycleDocument = LifecycleEventTarget & {
    visibilityState : string;
    hasFocus? : () => boolean;
};

export type LifecycleWindow = LifecycleEventTarget;

/** True for the states in which the page is visible and timers operate without throttling. */
export function isVisibleState(state : LifecycleState) : boolean {
    return state === "active" || state === "passive";
}

function isPersisted(event : unknown) : boolean {
    return (event as { persisted? : unknown } | undefined)?.persisted === true;
}

/**
 * The time of the event (`event.timeStamp`, in `performance.now()` time) if
 * it is applicable, or `now`. A timestamp after `now` is not applicable: old
 * browsers give `timeStamp` in Unix time.
 */
function eventTime(event : unknown, now : number) : number {
    const timeStamp = (event as { timeStamp? : unknown } | undefined)?.timeStamp;
    return typeof timeStamp === "number" && timeStamp > 0 && timeStamp <= now ? timeStamp : now;
}

/**
 * This class follows the transitions of the page lifecycle state. It gives:
 * - a mark and resolve API, to ask "which state changes occurred between
 *   point A and this time?"
 * - change subscriptions, for example to pause the monitors while the page
 *   is hidden (refer to `createMeasurementConditions`)
 *
 * The machine keeps the transitions only while a mark is open. On each
 * `resolve()` and `cancel()`, it removes the transitions that are older than
 * the earliest open mark. Thus, resolve or cancel each mark. Subscriptions
 * do not use marks.
 */
export class LifecycleStateMachine {
    private currentState : LifecycleState;
    private transitions : StateTransition[] = [];
    private readonly marks = new Map<symbol, number>(); // mark id -> index into transitions
    private readonly subscribers = new Set<(transition : StateTransition) => void>();
    private readonly attached : Array<{
        target : LifecycleEventTarget;
        type : string;
        listener : LifecycleListener;
        options : LifecycleListenerOptions;
    }> = [];
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
     * This method gives the current lifecycle state.
     *
     * `document.visibilityState` changes synchronously, but the browser
     * dispatches `visibilitychange` as a separate task. Thus, a timer
     * callback can start between the two. Each read synchronizes the state
     * from `visibilityState` again, so that such a callback also sees the
     * page as hidden.
     */
    getState() : LifecycleState {
        this.syncFromDocument();
        return this.currentState;
    }

    /**
     * This method puts a mark at the current point of the transition stream.
     * Use `resolve(mark)` later to get all transitions that occurred after
     * the mark.
     */
    mark() : LifecycleMark {
        this.syncFromDocument();
        const id = Symbol();
        this.marks.set(id, this.transitions.length);
        return { id };
    }

    /**
     * This method gives all transitions that occurred after the mark, and
     * then removes the mark. It gives an empty array if the mark is unknown,
     * for example if it is already resolved.
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
     * This method removes a mark, but it does not get its transitions. Use it
     * to abandon a mark, for example when a measurement ended and its data is
     * not necessary.
     */
    cancel(mark : LifecycleMark) : void {
        if (this.marks.delete(mark.id)) {
            this.compact();
        }
    }

    /** This method sends each transition to `listener`. It gives a function that removes the subscription. */
    subscribe(listener : (transition : StateTransition) => void) : () => void {
        this.subscribers.add(listener);
        return () => { this.subscribers.delete(listener); };
    }

    /** This method removes all DOM listeners, all marks, all subscribers and the buffered transitions. */
    dispose() : void {
        for (const { target, type, listener, options } of this.attached) {
            target.removeEventListener(type, listener, options);
        }
        this.attached.length = 0;
        this.subscribers.clear();
        this.marks.clear();
        this.transitions = [];
    }

    /** The number of transitions in the buffer at this time, for tests and debug. */
    getBufferedCount() : number {
        return this.transitions.length;
    }

    /** The number of open (unresolved) marks. */
    getMarkCount() : number {
        return this.marks.size;
    }

    /** The total number of transitions since the construction of the machine (a lifetime counter). */
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

    private syncFromDocument(event? : unknown) : void {
        if (this.document.visibilityState === "hidden") {
            if (isVisibleState(this.currentState)) {
                this.transition("hidden", "visibilitychange", event);
            }
        } else if (this.currentState === "hidden") {
            this.transition(this.visibleState(), "visibilitychange", event);
        }
    }

    private visibleState() : LifecycleState {
        const focused = this.document.hasFocus ? this.document.hasFocus() : true;
        return focused ? "active" : "passive";
    }

    private transition(to : LifecycleState, trigger : LifecycleTrigger, event? : unknown) : void {
        if (to === this.currentState) return;
        const transition : StateTransition = {
            from : this.currentState,
            to,
            trigger,
            timestamp : eventTime(event, this.clock.now()),
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

    private listen(
        target : LifecycleEventTarget,
        type : string,
        listener : LifecycleListener,
        options : LifecycleListenerOptions = {},
    ) : void {
        target.addEventListener(type, listener, options);
        this.attached.push({ target, type, listener, options });
    }

    private attachListeners() : void {
        // Not in the capture phase: a capture listener on the window also
        // gets the focus and blur events of each element in the page
        this.listen(this.window, "focus", (event) => {
            if (this.currentState === "passive") this.transition("active", "focus", event);
        });
        this.listen(this.window, "blur", (event) => {
            if (this.currentState === "active") this.transition("passive", "blur", event);
        });

        // In the capture phase: at the target, capture listeners go before
        // the other listeners. Thus the subscribers (for example the final
        // Web Vitals of a page view) record their values before an exporter
        // that listens to the same event flushes.
        const capture = { capture : true };
        this.listen(this.document, "visibilitychange", (event) => this.syncFromDocument(event), capture);

        this.listen(this.document, "freeze", (event) => this.transition("frozen", "freeze", event), capture);
        this.listen(this.document, "resume", (event) => this.transition("hidden", "resume", event), capture);

        this.listen(this.window, "pagehide", (event) => {
            this.transition(isPersisted(event) ? "frozen" : "terminated", "pagehide", event);
        }, capture);
        this.listen(this.window, "pageshow", (event) => {
            if (isPersisted(event)) this.transition(this.visibleState(), "pageshow", event);
        }, capture);
        // No beforeunload listener: it can be cancelled (leaving a live page
        // marked terminated) and it makes the page ineligible for the BFCache.
    }
}

/** A summary of the state changes in a list of transitions, from `summarizeTransitions`. */
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
