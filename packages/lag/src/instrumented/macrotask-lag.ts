import type { CoreDeps, TimerDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { MacrotaskLag } from "../MacrotaskLag.js";
import { LifecycleStateMachine } from "../LifecycleStateMachine.js";
import {
    macrotaskLagIntervalMs,
    maxLagBuffer,
} from "../constants.js";
import type {
    EventLoopLagAttributes,
    LagMeasurement,
} from "../types.js";

/**
 * Constructs a MacrotaskLag monitor wired to:
 * - `lag_macrotask_histogram` — per-sample macrotask scheduling delay (ms)
 * - `lag_macrotask_max_gauge` — worst sample since last collection
 * - `lag_macrotask_avg_gauge` — rolling average of recent samples
 *
 * MacrotaskLag measures how long a setTimeout(0) waits in the macrotask queue —
 * a proxy for queue depth / congestion. It fires every 5 seconds (too sparse
 * for LagLogger's sliding-window averaging, which is why this factory doesn't
 * use LagLogger — DriftLag handles that at 100ms intervals).
 */
export function createInstrumentedMacrotaskLag(
    deps : CoreDeps & TimerDeps,
    lifecycle : LifecycleStateMachine,
) : MonitorHandle<MacrotaskLag> {
    try {
        const histogram = deps.meter.createHistogram<EventLoopLagAttributes>(
            "lag_macrotask_histogram", { unit : "ms" });
        const maxGauge = deps.meter.createObservableGauge<EventLoopLagAttributes>(
            "lag_macrotask_max_gauge", { unit : "ms" });
        const avgGauge = deps.meter.createObservableGauge<EventLoopLagAttributes>(
            "lag_macrotask_avg_gauge", { unit : "ms" });

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

        const monitor = new MacrotaskLag(
            macrotaskLagIntervalMs,
            (value : number) => {
                const attributes : EventLoopLagAttributes = {
                    wasHidden : lifecycle.getAndResetHidden(),
                };
                if (attributes.wasHidden) return;

                const measurement : LagMeasurement = { value, attributes };
                histogram.record(value, attributes);

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

        return { name : "macrotask-lag", monitor, stop : () => monitor.stop() };
    } catch (error) {
        deps.logger.log("warn", "Failed to create MacrotaskLag monitor.", {
            error,
            type : "createInstrumentedMacrotaskLag",
        });
        return { name : "macrotask-lag", monitor : undefined, stop : () => {} };
    }
}
