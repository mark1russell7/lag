import type { AbsoluteClockDeps, CoreDeps, EventDeps, LifecycleDeps, PerformanceDeps, SpanDeps } from "../dep-groups.js";
import type { OpenSpan } from "../spans.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { LifecycleStateMachine } from "../LifecycleStateMachine.js";
import { EVENTS, METRICS, SPANS, createCounter } from "../metric-catalog.js";
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
    deps : CoreDeps & LifecycleDeps & Partial<EventDeps> & Partial<SpanDeps> & Partial<AbsoluteClockDeps> & Partial<PerformanceDeps>,
) : MonitorHandle<LifecycleStateMachine> {
    return createHandle("lifecycle", deps.logger, () => {
        const transitions = createCounter<TransitionAttributes>(deps.meter, METRICS.lifecycleTransitions);
        const clock = eventClock(deps);
        /** The span of the hidden or frozen period in which the page is. */
        let period : OpenSpan | undefined;

        // A tracker that the page shares: the factory only subscribes to it
        const shared = deps.lifecycleTracker;
        const machine = shared ?? new LifecycleStateMachine(deps.document, deps.window, deps.clock, deps.logger);
        const unsubscribe = machine.subscribe(({ from, to, trigger, timestamp }) => {
            transitions.add(1, { from, to, trigger });
            // The time of the transition is in the time of the clock of the monitors
            const options = occurredAtClockTime(clock, deps.clock, timestamp);
            deps.events?.emit(EVENTS.lifecycleTransition.name, { from, to, trigger }, options);
            const spans = deps.spans;
            if (!spans) return;
            const time = options.time ?? Date.now();
            period?.end(time);
            period = undefined;
            const name = to === "hidden" ? SPANS.hidden.name : to === "frozen" ? SPANS.frozen.name : undefined;
            if (!name) return;
            const parent = deps.pageViewSpans?.current();
            period = spans.start(name, { startTime : time, attributes : { trigger }, ...(parent ? { parent } : {}) });
        });

        return {
            monitor : machine,
            stop : () => {
                unsubscribe();
                if (!shared) machine.dispose();
                period?.end(clock ? clock.now() : Date.now());
                period = undefined;
            },
        };
    });
}
