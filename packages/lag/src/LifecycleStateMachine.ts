import type { Logger } from "./types.js";

/**
 * Page lifecycle states per the W3C/WICG Page Lifecycle spec.
 * See: https://developer.chrome.com/docs/web-platform/page-lifecycle-api
 *
 * State diagram:
 *   ┌──────────┐  blur     ┌──────────┐
 *   │  ACTIVE  │ ────────> │ PASSIVE  │
 *   │          │ <──────── │          │
 *   └─────┬────┘  focus    └─────┬────┘
 *         │                       │
 *         │       visibilitychange (hidden)
 *         │                       │
 *         v                       v
 *   ┌─────────────────────────────────┐  freeze   ┌─────────┐
 *   │             HIDDEN              │ ────────> │ FROZEN  │
 *   │                                 │ <──────── │         │
 *   └────┬────────────────────────────┘  resume   └────┬────┘
 *        │                                              │
 *        │ pagehide(persisted=false)                    │
 *        v                                              v
 *   ┌──────────────┐                              ┌────────────┐
 *   │  TERMINATED  │                              │ DISCARDED  │
 *   └──────────────┘                              └────────────┘
 */
export type LifecycleState =
    | "active"
    | "passive"
    | "hidden"
    | "frozen"
    | "terminated"
    | "discarded";

export type LifecycleTrigger =
    | "focus"
    | "blur"
    | "visibilitychange"
    | "freeze"
    | "resume"
    | "pagehide"
    | "pageshow"
    | "beforeunload"
    | "discard"
    | "init";

export type StateTransition = {
    from : LifecycleState;
    to : LifecycleState;
    trigger : LifecycleTrigger;
    timestamp : number;
};

export type LifecycleMark = {
    readonly id : symbol;
};

export type LifecycleEventTarget = {
    addEventListener(event : string, callback : (event? : { persisted? : boolean }) => void) : void;
};

export type LifecycleDocument = LifecycleEventTarget & {
    visibilityState : string;
    hasFocus? : () => boolean;
    wasDiscarded? : boolean;
};

export type LifecycleWindow = LifecycleEventTarget;

/**
 * Tracks page lifecycle state transitions and provides a mark/resolve API
 * for consumers to ask "what state changes happened between point A and now?".
 *
 * Memory is bounded: transitions older than the earliest unresolved mark are
 * compacted away on each resolve(). If no marks are outstanding, the buffer
 * is cleared completely.
 *
 * Multiple consumers can hold marks simultaneously without interfering.
 */
export class LifecycleStateMachine {
    private currentState : LifecycleState;
    private transitions : StateTransition[] = [];
    private marks = new Map<symbol, number>(); // mark id -> index into transitions

    constructor(
        private readonly document : LifecycleDocument,
        private readonly window : LifecycleWindow,
        private readonly clock : { now : () => number },
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _logger : Logger,
    ) {
        this.currentState = this.computeInitialState();
        // Record an initial transition so marks can capture the starting state
        this.transitions.push({
            from : this.currentState,
            to : this.currentState,
            trigger : "init",
            timestamp : this.clock.now(),
        });
        this.attachListeners();
    }

    /** Returns the current lifecycle state. */
    getState() : LifecycleState {
        return this.currentState;
    }

    /**
     * Place a mark at the current point in the transition stream.
     * Call resolve(mark) later to get all transitions that occurred after.
     */
    mark() : LifecycleMark {
        const id = Symbol();
        // Mark points just after the most recent transition
        this.marks.set(id, this.transitions.length);
        return { id };
    }

    /**
     * Get all transitions that have occurred since the mark, then drop the mark.
     * Triggers buffer compaction. Returns an empty array if the mark is unknown
     * (e.g., already resolved).
     */
    resolve(mark : LifecycleMark) : StateTransition[] {
        const startIdx = this.marks.get(mark.id);
        if (startIdx === undefined) return [];

        const result = this.transitions.slice(startIdx);
        this.marks.delete(mark.id);
        this.compact();
        return result;
    }

    /**
     * Drop a mark without retrieving its transitions. Use to abandon a mark
     * (e.g., the tracking session ended without needing the data).
     */
    cancel(mark : LifecycleMark) : void {
        if (this.marks.delete(mark.id)) {
            this.compact();
        }
    }

    /**
     * Number of transitions currently buffered (for debugging/testing).
     */
    getBufferedCount() : number {
        return this.transitions.length;
    }

    /**
     * Number of outstanding (unresolved) marks.
     */
    getMarkCount() : number {
        return this.marks.size;
    }

    /** Total number of transitions seen since startup (lifetime counter). */
    private totalTransitions = 0;
    getTotalTransitions() : number {
        return this.totalTransitions;
    }

    private compact() : void {
        if (this.marks.size === 0) {
            // No marks holding the buffer alive — drop everything
            this.transitions = [];
            return;
        }

        // Find the earliest mark and shift the buffer to start there
        let earliest = Infinity;
        for (const idx of this.marks.values()) {
            if (idx < earliest) earliest = idx;
        }

        if (earliest > 0 && earliest <= this.transitions.length) {
            this.transitions = this.transitions.slice(earliest);
            // Re-index all marks
            for (const [id, idx] of this.marks) {
                this.marks.set(id, idx - earliest);
            }
        }
    }

    private computeInitialState() : LifecycleState {
        if (this.document.visibilityState === "hidden") return "hidden";
        const focused = this.document.hasFocus ? this.document.hasFocus() : true;
        return focused ? "active" : "passive";
    }

    private transition(to : LifecycleState, trigger : LifecycleTrigger) : void {
        if (to === this.currentState) return;
        const from = this.currentState;
        this.currentState = to;
        this.transitions.push({
            from,
            to,
            trigger,
            timestamp : this.clock.now(),
        });
        this.totalTransitions++;
    }

    private attachListeners() : void {
        // Active <-> Passive
        this.window.addEventListener("focus", () => {
            if (this.currentState === "passive") this.transition("active", "focus");
        });
        this.window.addEventListener("blur", () => {
            if (this.currentState === "active") this.transition("passive", "blur");
        });

        // Hidden <-> Active/Passive
        this.document.addEventListener("visibilitychange", () => {
            if (this.document.visibilityState === "hidden") {
                if (this.currentState !== "frozen") {
                    this.transition("hidden", "visibilitychange");
                }
            } else {
                // Going from hidden back to visible
                if (this.currentState === "hidden") {
                    const focused = this.document.hasFocus ? this.document.hasFocus() : true;
                    this.transition(focused ? "active" : "passive", "visibilitychange");
                }
            }
        });

        // Hidden -> Frozen / Frozen -> Hidden
        this.document.addEventListener("freeze", () => {
            this.transition("frozen", "freeze");
        });
        this.document.addEventListener("resume", () => {
            // Browser restored a frozen page
            this.transition("hidden", "resume");
        });

        // Hidden -> Terminated
        this.window.addEventListener("pagehide", (event) => {
            if (event?.persisted) {
                // BFCache eviction path — page goes frozen
                this.transition("frozen", "pagehide");
            } else {
                this.transition("terminated", "pagehide");
            }
        });

        // BFCache restoration: pageshow with persisted=true
        this.window.addEventListener("pageshow", (event) => {
            if (event?.persisted) {
                // Restored from BFCache — return to active/passive based on focus
                const focused = this.document.hasFocus ? this.document.hasFocus() : true;
                this.transition(focused ? "active" : "passive", "pageshow");
            }
        });

        this.window.addEventListener("beforeunload", () => {
            // Defensive: page is about to terminate
            if (this.currentState !== "terminated") {
                this.transition("terminated", "beforeunload");
            }
        });
    }
}

/** Helper: extract a summary of state changes between two transition snapshots. */
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
    let wasHidden = false;
    let wasFrozen = false;
    let wasTerminated = false;
    let wasRestoredFromBFCache = false;
    let wasFocused = false;
    let wasBlurred = false;

    for (const t of transitions) {
        if (t.to === "hidden") wasHidden = true;
        if (t.to === "frozen") wasFrozen = true;
        if (t.to === "terminated") wasTerminated = true;
        if (t.trigger === "pageshow") wasRestoredFromBFCache = true;
        if (t.trigger === "focus") wasFocused = true;
        if (t.trigger === "blur") wasBlurred = true;
    }

    return {
        wasHidden,
        wasFrozen,
        wasTerminated,
        wasRestoredFromBFCache,
        wasFocused,
        wasBlurred,
        transitionCount : transitions.filter(t => t.trigger !== "init").length,
    };
}
