import type { CoreDeps, TimerDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { DriftLag } from "../DriftLag.js";
import { LagLogger } from "../LagLogger.js";
import type { MeasurementConditions } from "../measurement-conditions.js";
import { highFrequencyLagIntervalMs } from "../constants.js";
import { METRICS, createHistogram } from "../metric-catalog.js";
import { createHandle, validatedRecorder } from "./shared.js";

/**
 * Constructs a DriftLag monitor wired to `lag_drift_histogram` and to
 * LagLogger, which logs sustained lag over 2 s and 5 s windows.
 *
 * This is the primary high-frequency lag signal (one sample per 100 ms).
 * With `conditions`, the monitor pauses while the page is hidden, and a
 * sample whose window overlaps an unreliable interval is not recorded.
 */
export function createInstrumentedDriftLag(
    deps : CoreDeps & TimerDeps,
    conditions? : MeasurementConditions,
) : MonitorHandle<DriftLag> {
    return createHandle("drift-lag", deps.logger, () => {
        const histogram = createHistogram(deps.meter, METRICS.drift);
        const lagLogger = new LagLogger(highFrequencyLagIntervalMs, deps.logger);
        const recorder = validatedRecorder(conditions, (lag) => {
            histogram.record(lag);
            lagLogger.addMeasurement({ value : lag, attributes : { wasHidden : false } });
        });

        const monitor = new DriftLag(
            highFrequencyLagIntervalMs,
            (value : number) => {
                // A timer cannot fire early; a negative value is clock rounding
                const lag = Math.max(0, value);
                recorder.submit(lag, highFrequencyLagIntervalMs + lag);
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
