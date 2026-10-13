/**
 * The only module of the site that uses `page-lifecycle-tracker`. The
 * monitors of `@mark1russell7/lag` use the tracker that the page shares
 * (`getPageLifecycle()`). Thus the explainer of the lifecycle sees the same
 * transitions as the monitors, without a dependency on lag.
 */
import { getPageLifecycle, type LifecycleState, type StateTransition } from "page-lifecycle-tracker";

export type { LifecycleState, StateTransition };

/** The part of the shared tracker that the site uses. */
export type SharedLifecycle = {
    getState() : LifecycleState;
    /** This method gives the function that removes the subscription. */
    subscribe(listener : (transition : StateTransition) => void) : () => void;
};

/** The tracker that all scripts of this page share. The first use makes it. */
export function sharedLifecycle() : SharedLifecycle {
    return getPageLifecycle();
}
