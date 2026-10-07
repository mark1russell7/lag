import type { CoreDeps, TimerDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { MacrotaskLag } from "../MacrotaskLag.js";
import type { MeasurementConditions } from "../measurement-conditions.js";
import { macrotaskLagIntervalMs } from "../constants.js";
import { METRICS, createHistogram } from "../metric-catalog.js";
import { createHandle, validatedRecorder } from "./shared.js";

/**
 * Constructs a MacrotaskLag monitor wired to `lag_macrotask_histogram`.
 *
 * MacrotaskLag measures how long a setTimeout(0) waits in the task queue — a
 * proxy for queue depth. It samples every 5 seconds, too sparsely for the
 * LagLogger windows; DriftLag covers those. With `conditions`, the monitor
 * pauses while the page is hidden, and invalid samples are not recorded.
 */
export function createInstrumentedMacrotaskLag(
    deps : CoreDeps & TimerDeps,
    conditions? : MeasurementConditions,
) : MonitorHandle<MacrotaskLag> {
    return createHandle("macrotask-lag", deps.logger, () => {
        const histogram = createHistogram(deps.meter, METRICS.macrotask);
        const recorder = validatedRecorder(conditions, (lag) => histogram.record(lag));

        const monitor = new MacrotaskLag(
            macrotaskLagIntervalMs,
            (value : number) => {
                const lag = Math.max(0, value);
                recorder.submit(lag, lag);
            },
            deps.logger,
            deps.setIntervalFn,
            deps.clearIntervalFn,
            deps.setTimeoutFn,
            deps.clearTimeoutFn,
            deps.clock,
        );
        const unpause = conditions?.pauseWhileHidden(monitor);

        return {
            monitor,
            stop : () => {
                unpause?.();
                monitor.stop();
                recorder.dispose();
            },
        };
    });
}
