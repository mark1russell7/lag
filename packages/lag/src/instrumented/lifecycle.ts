import type { AbsoluteClockDeps, CoreDeps, EventDeps, LifecycleDeps, PerformanceDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { LifecycleStateMachine } from "../LifecycleStateMachine.js";
import { EVENTS, METRICS, createCounter } from "../metric-catalog.js";
import { createHandle, eventClock, occurredAtClockTime } from "./shared.js";

type TransitionAttributes = {
    from : string;
    to : string;
    trigger : string;
};

/**
 * This factory makes a `LifecycleStateMachine` that records into the
 * `lag_lifecycle_transitions` counter, with the attributes `from`, `to` and
 * `trigger`. With an event sink, it also emits a `lag.lifecycle.transition`
 * event for each transition, at the time of the browser event. Thus a chart
 * can show the transitions on the metrics.
 *
 * The measurement conditions of the other monitors use this machine. Stop it
 * last. The LIFO order of the registry does this.
 */
export function createInstrumentedLifecycle(
    deps : CoreDeps & LifecycleDeps & Partial<EventDeps> & Partial<AbsoluteClockDeps> & Partial<PerformanceDeps>,
) : MonitorHandle<LifecycleStateMachine> {
    return createHandle("lifecycle", deps.logger, () => {
        const transitions = createCounter<TransitionAttributes>(deps.meter, METRICS.lifecycleTransitions);
        const clock = eventClock(deps);

        const machine = new LifecycleStateMachine(deps.document, deps.window, deps.clock, deps.logger);
        machine.subscribe(({ from, to, trigger, timestamp }) => {
            transitions.add(1, { from, to, trigger });
            // The time of the transition is in the time of the clock of the monitors
            deps.events?.emit(EVENTS.lifecycleTransition.name, { from, to, trigger }, occurredAtClockTime(clock, deps.clock, timestamp));
        });

        return { monitor : machine, stop : () => machine.dispose() };
    });
}
