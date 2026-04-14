import type { CoreDeps, IdleDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { IdleAvailabilityMonitor, type IdleMeasurement } from "../IdleAvailabilityMonitor.js";

/**
 * Constructs an IdleAvailabilityMonitor wired to two histograms + one gauge.
 *
 * Metrics:
 * - `lag_idle_time_remaining_histogram` — idle slice size available (ms)
 * - `lag_idle_gap_histogram` — gap between idle fires (ms)
 * - `lag_idle_timeout_rate_gauge` — fraction of idle fires that hit the timeout
 */
export function createInstrumentedIdleAvailability(
    deps : CoreDeps & IdleDeps,
) : MonitorHandle<IdleAvailabilityMonitor> {
    try {
        const remainingHist = deps.meter.createHistogram<IdleMeasurement>(
            "lag_idle_time_remaining_histogram", { unit : "ms" });
        const gapHist = deps.meter.createHistogram<IdleMeasurement>(
            "lag_idle_gap_histogram", { unit : "ms" });
        const timeoutGauge = deps.meter.createObservableGauge<Record<string, never>>(
            "lag_idle_timeout_rate_gauge", { unit : "ratio" });

        const monitor = new IdleAvailabilityMonitor(
            (m) => {
                remainingHist.record(m.timeRemainingMs, m);
                if (m.timeSinceLastIdleMs > 0) {
                    gapHist.record(m.timeSinceLastIdleMs, m);
                }
            },
            deps.logger,
            deps.requestIdleCallback,
            deps.cancelIdleCallback,
            deps.clock,
        );

        timeoutGauge.addCallback((result) => {
            result.observe(monitor.getTimeoutRate());
        });

        return { name : "idle-availability", monitor, stop : () => monitor.stop() };
    } catch (error) {
        deps.logger.log("warn", "Failed to create IdleAvailabilityMonitor.", {
            error,
            type : "createInstrumentedIdleAvailability",
        });
        return { name : "idle-availability", monitor : undefined, stop : () => {} };
    }
}
