import type { CoreDeps, IdleDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { IdleAvailabilityMonitor, type IdleMeasurement } from "../IdleAvailabilityMonitor.js";
import type { MeasurementConditions } from "../measurement-conditions.js";
import { METRICS, createCounter, createHistogram } from "../metric-catalog.js";
import { createHandle } from "./shared.js";

/**
 * Constructs an IdleAvailabilityMonitor wired to two histograms and the
 * `lag_idle_callbacks` counter.
 *
 * The fleet timeout rate is `rate(lag_idle_callbacks{timed_out="true"})`
 * divided by the rate of all callbacks. With `conditions`, the monitor
 * pauses while the page is hidden.
 */
export function createInstrumentedIdleAvailability(
    deps : CoreDeps & IdleDeps,
    conditions? : MeasurementConditions,
) : MonitorHandle<IdleAvailabilityMonitor> {
    return createHandle("idle-availability", deps.logger, () => {
        const remainingHist = createHistogram(deps.meter, METRICS.idleTimeRemaining);
        const gapHist = createHistogram(deps.meter, METRICS.idleGap);
        const callbacks = createCounter<{ timed_out : "true" | "false" }>(deps.meter, METRICS.idleCallbacks);
        const validator = conditions?.createValidator();

        const record = (m : IdleMeasurement) : void => {
            remainingHist.record(m.timeRemainingMs);
            if (m.timeSinceLastIdleMs > 0) gapHist.record(m.timeSinceLastIdleMs);
            callbacks.add(1, { timed_out : m.didTimeout ? "true" : "false" });
        };

        const monitor = new IdleAvailabilityMonitor(
            (m) => {
                if (validator) validator.submit(m.timeSinceLastIdleMs, m.timeSinceLastIdleMs, () => record(m));
                else record(m);
            },
            deps.logger,
            deps.requestIdleCallback,
            deps.cancelIdleCallback,
            deps.clock,
        );
        const unpause = conditions?.pauseWhileHidden(monitor);

        return {
            monitor,
            stop : () => {
                unpause?.();
                monitor.stop();
                validator?.dispose();
            },
        };
    });
}
