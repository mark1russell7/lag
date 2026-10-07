import type { CoreDeps, TimerDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { MacrotaskLag } from "../MacrotaskLag.js";
import type { LifecycleStateMachine } from "../LifecycleStateMachine.js";
import { macrotaskLagIntervalMs } from "../constants.js";
import { createHandle, createWindowGauges, pauseWhileHidden } from "./shared.js";

/**
 * Constructs a MacrotaskLag monitor wired to:
 * - `lag_macrotask_histogram` — per-sample macrotask scheduling delay (ms)
 * - `lag_macrotask_max_gauge` — worst sample since the last collection
 * - `lag_macrotask_avg_gauge` — mean of the samples since the last collection
 *
 * MacrotaskLag measures how long a setTimeout(0) waits in the macrotask queue —
 * a proxy for queue depth / congestion. It samples every 5 seconds, too
 * sparsely for LagLogger's 2s/5s windows; DriftLag covers that.
 *
 * With a `lifecycle`, the monitor is paused while the page is hidden and any
 * sample whose window overlapped a hidden period is discarded.
 */
export function createInstrumentedMacrotaskLag(
    deps : CoreDeps & TimerDeps,
    lifecycle? : LifecycleStateMachine,
) : MonitorHandle<MacrotaskLag> {
    return createHandle("macrotask-lag", deps.logger, () => {
        const histogram = deps.meter.createHistogram("lag_macrotask_histogram", { unit : "ms" });
        const gauges = createWindowGauges(
            deps.meter, { max : "lag_macrotask_max_gauge", avg : "lag_macrotask_avg_gauge" }, "ms");
        const gate = lifecycle?.createHiddenGate();

        const monitor = new MacrotaskLag(
            macrotaskLagIntervalMs,
            (value : number) => {
                if (gate?.wasHiddenSinceLastCheck()) return;
                histogram.record(value);
                gauges.record(value);
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
