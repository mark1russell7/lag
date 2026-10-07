import type { CoreDeps, IdleDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { IdleAvailabilityMonitor } from "../IdleAvailabilityMonitor.js";
import type { LifecycleStateMachine } from "../LifecycleStateMachine.js";
import { createHandle, observe, pauseWhileHidden } from "./shared.js";

/**
 * Constructs an IdleAvailabilityMonitor wired to two histograms + one gauge.
 *
 * Metrics:
 * - `lag_idle_time_remaining_histogram` — idle slice size available (ms)
 * - `lag_idle_gap_histogram` — gap between idle fires (ms)
 * - `lag_idle_timeout_rate_gauge` — fraction of idle fires since the last
 *   collection that only ran because their timeout expired
 *
 * With a `lifecycle`, the monitor is paused while the page is hidden.
 */
export function createInstrumentedIdleAvailability(
    deps : CoreDeps & IdleDeps,
    lifecycle? : LifecycleStateMachine,
) : MonitorHandle<IdleAvailabilityMonitor> {
    return createHandle("idle-availability", deps.logger, () => {
        const remainingHist = deps.meter.createHistogram("lag_idle_time_remaining_histogram", { unit : "ms" });
        const gapHist = deps.meter.createHistogram("lag_idle_gap_histogram", { unit : "ms" });

        let fires = 0;
        let timeouts = 0;

        const monitor = new IdleAvailabilityMonitor(
            (m) => {
                remainingHist.record(m.timeRemainingMs);
                if (m.timeSinceLastIdleMs > 0) {
                    gapHist.record(m.timeSinceLastIdleMs);
                }
                fires++;
                if (m.didTimeout) timeouts++;
            },
            deps.logger,
            deps.requestIdleCallback,
            deps.cancelIdleCallback,
            deps.clock,
        );
        const unpause = lifecycle ? pauseWhileHidden(lifecycle, monitor) : undefined;

        const unobserve = observe(
            deps.meter.createObservableGauge("lag_idle_timeout_rate_gauge", { unit : "ratio" }),
            (result) => {
                if (fires > 0) result.observe(timeouts / fires);
                fires = 0;
                timeouts = 0;
            },
        );

        return {
            monitor,
            stop : () => {
                unpause?.();
                unobserve();
                monitor.stop();
            },
        };
    });
}
