import type { CoreDeps, LifecycleDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { LifecycleStateMachine } from "../LifecycleStateMachine.js";
import { createHandle } from "./shared.js";

type TransitionAttributes = {
    from : string;
    to : string;
    trigger : string;
};

/**
 * Constructs a LifecycleStateMachine wired to a transition counter.
 *
 * Metric:
 * - `lag_lifecycle_transitions` — +1 per transition, labeled with `from`,
 *   `to` and `trigger` so dashboards can count specific state changes
 *   (e.g. how often the page went hidden).
 *
 * The other timer-driven factories take this machine to pause while hidden;
 * stop it last (the registry's LIFO order does).
 */
export function createInstrumentedLifecycle(
    deps : CoreDeps & LifecycleDeps,
) : MonitorHandle<LifecycleStateMachine> {
    return createHandle("lifecycle", deps.logger, () => {
        const transitions = deps.meter.createCounter<TransitionAttributes>(
            "lag_lifecycle_transitions", { unit : "{transition}" });

        const machine = new LifecycleStateMachine(deps.document, deps.window, deps.clock, deps.logger);
        machine.subscribe(({ from, to, trigger }) => {
            transitions.add(1, { from, to, trigger });
        });

        return { monitor : machine, stop : () => machine.dispose() };
    });
}
