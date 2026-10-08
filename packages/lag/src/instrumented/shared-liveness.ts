import type { CoreDeps, WorkerMonitorDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { SharedLivenessMonitor, type SharedLivenessOptions } from "../SharedLivenessMonitor.js";
import type { MeasurementConditions } from "../measurement-conditions.js";
import { METRICS, createHistogram } from "../metric-catalog.js";
import { createHandle, validatedRecorder } from "./shared.js";

/**
 * This factory makes a `SharedLivenessMonitor` that records into
 * `lag_liveness_block_histogram`. The caller makes the buffer, and it makes
 * a frequent main-thread callback beat the counter. (`setupAllMonitors`
 * decorates the `DriftLag` timer.)
 *
 * With `conditions`, the monitor pauses while the page is hidden, because no
 * beats occur then. Also, it does not record a block that overlaps an
 * unreliable interval, for example a system suspend.
 */
export function createInstrumentedSharedLiveness(
    deps : CoreDeps & Pick<WorkerMonitorDeps, "worker"> & { livenessBuffer : SharedArrayBuffer; livenessOptions? : SharedLivenessOptions },
    conditions? : MeasurementConditions,
) : MonitorHandle<SharedLivenessMonitor> {
    return createHandle("shared-liveness", deps.logger, () => {
        const blockHist = createHistogram(deps.meter, METRICS.livenessBlock);
        const recorder = validatedRecorder(conditions, (ms) => blockHist.record(ms));

        const monitor = new SharedLivenessMonitor(
            deps.worker,
            deps.livenessBuffer,
            (durationMs) => recorder.submit(durationMs, durationMs),
            deps.logger,
            deps.livenessOptions,
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
