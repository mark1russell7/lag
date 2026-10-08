import type { CoreDeps, SchedulingDeps, TimerDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { DriftLag } from "../DriftLag.js";
import { createMessageTaskQueue } from "../message-task.js";
import { LagLogger } from "../LagLogger.js";
import type { MeasurementConditions } from "../measurement-conditions.js";
import { highFrequencyLagIntervalMs } from "../constants.js";
import { METRICS, createHistogram } from "../metric-catalog.js";
import { createHandle, validatedRecorder } from "./shared.js";

/**
 * This factory makes a `DriftLag` monitor that records into
 * `lag_drift_histogram`, into `lag_drift_baseline_histogram` (the calibrated
 * idle step) and into `LagLogger`. `LagLogger` logs sustained lag in periods
 * of 2 s and 5 s.
 *
 * This monitor gives the primary high-frequency lag signal (one sample for
 * each window of approximately 100 ms). With `conditions`, the monitor
 * pauses while the page is hidden. Also, it does not record a sample whose
 * window overlaps an unreliable interval, and it records the baseline only
 * with a valid sample. With `deps.MessageChannel`, a probe of message tasks
 * confirms each larger increase of the baseline. Thus, a sustained load
 * does not increase the baseline.
 */
export function createInstrumentedDriftLag(
    deps : CoreDeps & TimerDeps & Partial<Pick<SchedulingDeps, "MessageChannel">>,
    conditions? : MeasurementConditions,
) : MonitorHandle<DriftLag> {
    return createHandle("drift-lag", deps.logger, () => {
        const histogram = createHistogram(deps.meter, METRICS.drift);
        const baselineHistogram = createHistogram(deps.meter, METRICS.driftBaseline);
        const lagLogger = new LagLogger(highFrequencyLagIntervalMs, deps.logger);
        const tasks = deps.MessageChannel ? createMessageTaskQueue(deps.MessageChannel) : undefined;
        const recorder = validatedRecorder(conditions, (lag, windowMs) => {
            histogram.record(lag);
            baselineHistogram.record(monitor.getBaselineMs());
            lagLogger.addMeasurement({ value : lag, attributes : { wasHidden : false }, intervalMs : windowMs - lag });
        });

        const monitor : DriftLag = new DriftLag(
            highFrequencyLagIntervalMs,
            (value : number) => {
                // A negative value is jitter around the baseline
                recorder.submit(Math.max(0, value), monitor.getLastWindowMs());
            },
            deps.logger,
            deps.setIntervalFn,
            deps.clearIntervalFn,
            deps.setTimeoutFn,
            deps.clearTimeoutFn,
            deps.clock,
            tasks ? { postTask : (callback) => tasks.post(callback) } : {},
        );
        const unpause = conditions?.pauseWhileHidden(monitor);

        return {
            monitor,
            stop : () => {
                unpause?.();
                monitor.stop();
                tasks?.close();
                recorder.dispose();
            },
        };
    });
}
