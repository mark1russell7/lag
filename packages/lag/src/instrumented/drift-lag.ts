import type { CoreDeps, TimerDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { DriftLag } from "../DriftLag.js";
import { LagLogger } from "../LagLogger.js";
import type { MeasurementConditions } from "../measurement-conditions.js";
import { highFrequencyLagIntervalMs } from "../constants.js";
import { METRICS, createHistogram } from "../metric-catalog.js";
import { createHandle, validatedRecorder } from "./shared.js";

/**
 * This factory makes a `DriftLag` monitor that records into
 * `lag_drift_histogram`, into `lag_drift_baseline_histogram` (the calibrated
 * idle step) and into `LagLogger`. `LagLogger` logs sustained lag in windows
 * of 2 s and 5 s.
 *
 * This monitor gives the primary high-frequency lag signal (one sample for
 * each 100 ms). With `conditions`, the monitor pauses while the page is
 * hidden. Also, it does not record a sample whose window overlaps an
 * unreliable interval.
 */
export function createInstrumentedDriftLag(
    deps : CoreDeps & TimerDeps,
    conditions? : MeasurementConditions,
) : MonitorHandle<DriftLag> {
    return createHandle("drift-lag", deps.logger, () => {
        const histogram = createHistogram(deps.meter, METRICS.drift);
        const baselineHistogram = createHistogram(deps.meter, METRICS.driftBaseline);
        const lagLogger = new LagLogger(highFrequencyLagIntervalMs, deps.logger);
        const recorder = validatedRecorder(conditions, (lag) => {
            histogram.record(lag);
            lagLogger.addMeasurement({ value : lag, attributes : { wasHidden : false } });
        });

        const monitor : DriftLag = new DriftLag(
            highFrequencyLagIntervalMs,
            (value : number) => {
                // A negative value is jitter around the baseline
                const lag = Math.max(0, value);
                recorder.submit(lag, highFrequencyLagIntervalMs + lag);
                baselineHistogram.record(monitor.getBaselineMs());
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
