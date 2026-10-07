import type { CoreDeps, TimerDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { DriftLag } from "../DriftLag.js";
import { LagLogger } from "../LagLogger.js";
import type { LifecycleStateMachine } from "../LifecycleStateMachine.js";
import { highFrequencyLagIntervalMs } from "../constants.js";
import { createHandle, createWindowGauges, pauseWhileHidden } from "./shared.js";

/**
 * Constructs a DriftLag monitor wired to:
 * - `lag_drift_histogram` — per-measurement lag (ms)
 * - `lag_drift_max_gauge` — worst sample since the last collection
 * - `lag_drift_avg_gauge` — mean of the samples since the last collection
 * + LagLogger for threshold-based log emission (sliding 2s/5s windows)
 *
 * This is the primary high-frequency lag signal (one sample per 100ms).
 *
 * With a `lifecycle`, the monitor is paused while the page is hidden, and a
 * sample whose window overlapped a hidden period (the event can lag the
 * actual visibility change) is discarded.
 */
export function createInstrumentedDriftLag(
    deps : CoreDeps & TimerDeps,
    lifecycle? : LifecycleStateMachine,
) : MonitorHandle<DriftLag> {
    return createHandle("drift-lag", deps.logger, () => {
        const histogram = deps.meter.createHistogram("lag_drift_histogram", { unit : "ms" });
        const gauges = createWindowGauges(
            deps.meter, { max : "lag_drift_max_gauge", avg : "lag_drift_avg_gauge" }, "ms");
        const lagLogger = new LagLogger(highFrequencyLagIntervalMs, deps.logger);
        const gate = lifecycle?.createHiddenGate();

        const monitor = new DriftLag(
            highFrequencyLagIntervalMs,
            (value : number) => {
                if (gate?.wasHiddenSinceLastCheck()) return;
                histogram.record(value);
                gauges.record(value);
                lagLogger.addMeasurement({ value, attributes : { wasHidden : false } });
            },
            deps.logger,
            deps.setIntervalFn,
            deps.clearIntervalFn,
            deps.setTimeoutFn,
            deps.clearTimeoutFn,
            deps.clock,
        );
        const unpause = lifecycle ? pauseWhileHidden(lifecycle, monitor, gate) : undefined;

        return {
            monitor,
            stop : () => {
                unpause?.();
                monitor.stop();
                gate?.dispose();
                gauges.dispose();
            },
        };
    });
}
