import type { CoreDeps, LifecycleDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { LifecycleStateMachine } from "../LifecycleStateMachine.js";
import { METRICS, createCounter } from "../metric-catalog.js";
import { createHandle } from "./shared.js";

type TransitionAttributes = {
    from : string;
    to : string;
    trigger : string;
};

/**
 * This factory makes a `LifecycleStateMachine` that records into the
 * `lag_lifecycle_transitions` counter, with the attributes `from`, `to` and
 * `trigger`.
 *
 * The measurement conditions of the other monitors use this machine. Stop it
 * last. The LIFO order of the registry does this.
 */
export function createInstrumentedLifecycle(
    deps : CoreDeps & LifecycleDeps,
) : MonitorHandle<LifecycleStateMachine> {
    return createHandle("lifecycle", deps.logger, () => {
        const transitions = createCounter<TransitionAttributes>(deps.meter, METRICS.lifecycleTransitions);

        const machine = new LifecycleStateMachine(deps.document, deps.window, deps.clock, deps.logger);
        machine.subscribe(({ from, to, trigger }) => {
            transitions.add(1, { from, to, trigger });
        });

        return { monitor : machine, stop : () => machine.dispose() };
    });
}
