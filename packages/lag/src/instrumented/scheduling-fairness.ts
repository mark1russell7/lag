import type { CoreDeps, TimerDeps, SchedulingDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { SchedulingFairnessMonitor } from "../SchedulingFairnessMonitor.js";
import type { LifecycleStateMachine } from "../LifecycleStateMachine.js";
import { createHandle, pauseWhileHidden } from "./shared.js";

const DEFAULT_INTERVAL_MS = 5_000;

/**
 * Constructs a SchedulingFairnessMonitor wired to three histograms.
 *
 * Metrics (all ms):
 * - `lag_scheduling_microtask_histogram` — queueMicrotask() latency (a ~0 baseline)
 * - `lag_scheduling_macrotask_histogram` — setTimeout(0) latency
 * - `lag_scheduling_message_channel_histogram` — MessageChannel postMessage latency
 *
 * See SchedulingFairnessMonitor for how to read them together. With a
 * `lifecycle`, the monitor is paused while the page is hidden.
 */
export function createInstrumentedSchedulingFairness(
    deps : CoreDeps & TimerDeps & SchedulingDeps,
    lifecycle? : LifecycleStateMachine,
    intervalMs : number = DEFAULT_INTERVAL_MS,
) : MonitorHandle<SchedulingFairnessMonitor> {
    return createHandle("scheduling-fairness", deps.logger, () => {
        const microHist = deps.meter.createHistogram("lag_scheduling_microtask_histogram", { unit : "ms" });
        const macroHist = deps.meter.createHistogram("lag_scheduling_macrotask_histogram", { unit : "ms" });
        const channelHist = deps.meter.createHistogram("lag_scheduling_message_channel_histogram", { unit : "ms" });

        const monitor = new SchedulingFairnessMonitor(
            intervalMs,
            (m) => {
                microHist.record(m.microtaskMs);
                macroHist.record(m.macrotaskMs);
                channelHist.record(m.messageChannelMs);
            },
            deps.logger,
            deps.setIntervalFn,
            deps.clearIntervalFn,
            deps.setTimeoutFn,
            deps.queueMicrotask,
            deps.MessageChannel,
            deps.clock,
        );
        const unpause = lifecycle ? pauseWhileHidden(lifecycle, monitor) : undefined;

        return {
            monitor,
            stop : () => {
                unpause?.();
                monitor.stop();
            },
        };
    });
}
