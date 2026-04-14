import type { CoreDeps, TimerDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { DriftLag } from "../DriftLag.js";
import { LagLogger } from "../LagLogger.js";
import { LifecycleStateMachine } from "../LifecycleStateMachine.js";
import {
    highFrequencyLagIntervalMs,
    maxLagBuffer,
} from "../constants.js";
import type {
    EventLoopLagAttributes,
    LagMeasurement,
} from "../types.js";

/**
 * Constructs a DriftLag monitor wired to:
 * - `lag_drift_histogram` — per-measurement lag (ms)
 * - `lag_drift_max_gauge` — worst sample since last collection
 * - `lag_drift_avg_gauge` — rolling average of recent samples
 * + LagLogger for threshold-based log emission (sliding 2s/5s windows)
 *
 * Measurements are discarded if the page was hidden during the interval
 * (via `lifecycle.getAndResetHidden()`). This is the primary high-frequency
 * lag signal: DriftLag self-corrects for accumulated drift from timer
 * scheduling delays, making it more accurate than a naive setTimeout recursion.
 */
export function createInstrumentedDriftLag(
    deps : CoreDeps & TimerDeps,
    lifecycle : LifecycleStateMachine,
) : MonitorHandle<DriftLag> {
    try {
        const histogram = deps.meter.createHistogram<EventLoopLagAttributes>(
            "lag_drift_histogram", { unit : "ms" });
        const maxGauge = deps.meter.createObservableGauge<EventLoopLagAttributes>(
            "lag_drift_max_gauge", { unit : "ms" });
        const avgGauge = deps.meter.createObservableGauge<EventLoopLagAttributes>(
            "lag_drift_avg_gauge", { unit : "ms" });

        const lagLogger = new LagLogger(highFrequencyLagIntervalMs, deps.logger);

        let max : LagMeasurement | undefined;
        const buffer : LagMeasurement[] = [];

        maxGauge.addCallback((result) => {
            if (max) result.observe(max.value, max.attributes);
        });

        avgGauge.addCallback((result) => {
            if (buffer.length === 0) return;
            const sum = buffer.reduce((acc, m) => acc + m.value, 0);
            const avg = sum / buffer.length;
            const representativeAttrs = buffer[buffer.length - 1]!.attributes;
            result.observe(avg, representativeAttrs);
            buffer.length = 0;
        });

        const monitor = new DriftLag(
            highFrequencyLagIntervalMs,
            (value : number) => {
                const attributes : EventLoopLagAttributes = {
                    wasHidden : lifecycle.getAndResetHidden(),
                };
                if (attributes.wasHidden) return;

                const measurement : LagMeasurement = { value, attributes };
                histogram.record(value, attributes);
                lagLogger.addMeasurement(measurement);

                buffer.push(measurement);
                if (buffer.length >= maxLagBuffer) buffer.shift();

                if (!max || value > max.value) max = measurement;
            },
            deps.logger,
            deps.setIntervalFn,
            deps.clearIntervalFn,
            deps.setTimeoutFn,
            deps.clearTimeoutFn,
            deps.clock,
        );

        return { name : "drift-lag", monitor, stop : () => monitor.stop() };
    } catch (error) {
        deps.logger.log("warn", "Failed to create DriftLag monitor.", {
            error,
            type : "createInstrumentedDriftLag",
        });
        return { name : "drift-lag", monitor : undefined, stop : () => {} };
    }
}
