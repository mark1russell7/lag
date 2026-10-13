/**
 * The model of the live lifecycle view. It has the states of the page
 * lifecycle tracker, and it calculates the periods of each state of this tab
 * in a time window.
 */

export type LifecycleStateName = "active" | "passive" | "hidden" | "frozen" | "terminated";

export const LIFECYCLE_STATES : ReadonlyArray<{ state : LifecycleStateName; meaning : string }> = [
    { state : "active", meaning : "Visible, with the focus" },
    { state : "passive", meaning : "Visible, without the focus" },
    { state : "hidden", meaning : "Not visible" },
    { state : "frozen", meaning : "The browser stopped the tasks" },
    { state : "terminated", meaning : "The page unloads" },
];

/** One transition, with its time in `performance.now()` time (ms). */
export type ObservedTransition = {
    from : LifecycleStateName;
    to : LifecycleStateName;
    trigger : string;
    timestamp : number;
};

/** A period in one state. The times are in `performance.now()` time (ms). */
export type StateSegment = {
    state : LifecycleStateName;
    start : number;
    end : number;
};

/**
 * This function gives the periods of each state from `since` to `now`. The
 * first period starts in `initial` at `observedFrom`. A period that starts
 * before `since` starts at `since`. A transition with the same `from` and
 * `to` (a restore from the back/forward cache) starts a new period.
 */
export function segmentsOf(
    initial : LifecycleStateName,
    observedFrom : number,
    transitions : readonly ObservedTransition[],
    since : number,
    now : number,
) : StateSegment[] {
    const segments : StateSegment[] = [];
    let state = initial;
    let start = observedFrom;
    const close = (end : number) : void => {
        const clippedStart = Math.max(start, since);
        const clippedEnd = Math.min(end, now);
        if (clippedEnd > clippedStart) segments.push({ state, start : clippedStart, end : clippedEnd });
    };
    for (const transition of transitions) {
        const time = Math.min(Math.max(transition.timestamp, start), now);
        close(time);
        state = transition.to;
        start = time;
    }
    close(now);
    return segments;
}

/** The time in each state from `since` to `now`, in ms. */
export function timeInStates(segments : readonly StateSegment[]) : Record<LifecycleStateName, number> {
    const totals : Record<LifecycleStateName, number> = { active : 0, passive : 0, hidden : 0, frozen : 0, terminated : 0 };
    for (const segment of segments) totals[segment.state] += segment.end - segment.start;
    return totals;
}
