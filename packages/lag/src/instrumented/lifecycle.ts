import type { CoreDeps, LifecycleDeps, TimerDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import {
    LifecycleStateMachine,
    type StateTransition,
} from "../LifecycleStateMachine.js";

const TRANSITION_POLL_INTERVAL_MS = 5_000;

type TransitionAttributes = {
    from : string;
    to : string;
    trigger : string;
};

/**
 * Constructs a LifecycleStateMachine + periodic transition flusher.
 *
 * Metric:
 * - `lag_lifecycle_transition_count_histogram` — records 1 per transition,
 *   labeled with `from`, `to`, and `trigger` so dashboards can count
 *   specific state changes (e.g., how often the page went hidden).
 *
 * **Fix for the `__stopPoll` hack:** the factory owns the polling interval
 * and includes its teardown in the returned handle's `stop()`. No type-unsafe
 * property attachment, no lost handle.
 */
export function createInstrumentedLifecycle(
    deps : CoreDeps & LifecycleDeps & Pick<TimerDeps, "setIntervalFn" | "clearIntervalFn">,
) : MonitorHandle<LifecycleStateMachine> {
    try {
        const transitionHist = deps.meter.createHistogram<TransitionAttributes>(
            "lag_lifecycle_transition_count_histogram", { unit : "count" });

        const machine = new LifecycleStateMachine(
            deps.document,
            deps.window,
            deps.clock,
            deps.logger,
        );

        // Hold a single long-lived mark; resolve+remark each poll cycle to
        // capture whatever transitions accumulated in between.
        let mark = machine.mark();

        const handle = deps.setIntervalFn(() => {
            const transitions : StateTransition[] = machine.resolve(mark);
            for (const t of transitions) {
                if (t.trigger === "init") continue; // skip synthetic init event
                transitionHist.record(1, {
                    from : t.from,
                    to : t.to,
                    trigger : t.trigger,
                });
            }
            mark = machine.mark();
        }, TRANSITION_POLL_INTERVAL_MS);

        return {
            name : "lifecycle",
            monitor : machine,
            stop : () => {
                deps.clearIntervalFn(handle);
                machine.cancel(mark);
            },
        };
    } catch (error) {
        deps.logger.log("warn", "Failed to create LifecycleStateMachine.", {
            error,
            type : "createInstrumentedLifecycle",
        });
        return { name : "lifecycle", monitor : undefined, stop : () => {} };
    }
}
