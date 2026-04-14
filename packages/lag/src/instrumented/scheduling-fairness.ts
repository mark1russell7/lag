import type { CoreDeps, TimerDeps, SchedulingDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import {
    SchedulingFairnessMonitor,
    type SchedulingMeasurement,
} from "../SchedulingFairnessMonitor.js";

const DEFAULT_INTERVAL_MS = 5_000;

/**
 * Constructs a SchedulingFairnessMonitor wired to three histograms.
 *
 * Metrics (all ms):
 * - `lag_scheduling_microtask_histogram` — queueMicrotask() latency
 * - `lag_scheduling_macrotask_histogram` — setTimeout(0) latency
 * - `lag_scheduling_message_channel_histogram` — MessageChannel postMessage latency
 *
 * Comparing these three reveals scheduling bias — e.g., if microtask >> macrotask,
 * the engine is starving the macrotask queue.
 */
export function createInstrumentedSchedulingFairness(
    deps : CoreDeps & TimerDeps & SchedulingDeps,
    intervalMs : number = DEFAULT_INTERVAL_MS,
) : MonitorHandle<SchedulingFairnessMonitor> {
    try {
        const microHist = deps.meter.createHistogram<SchedulingMeasurement>(
            "lag_scheduling_microtask_histogram", { unit : "ms" });
        const macroHist = deps.meter.createHistogram<SchedulingMeasurement>(
            "lag_scheduling_macrotask_histogram", { unit : "ms" });
        const channelHist = deps.meter.createHistogram<SchedulingMeasurement>(
            "lag_scheduling_message_channel_histogram", { unit : "ms" });

        const monitor = new SchedulingFairnessMonitor(
            intervalMs,
            (m) => {
                microHist.record(m.microtaskMs, m);
                macroHist.record(m.macrotaskMs, m);
                channelHist.record(m.messageChannelMs, m);
            },
            deps.logger,
            deps.setIntervalFn,
            deps.clearIntervalFn,
            deps.setTimeoutFn,
            deps.queueMicrotask,
            deps.MessageChannel,
            deps.clock,
        );

        return { name : "scheduling-fairness", monitor, stop : () => monitor.stop() };
    } catch (error) {
        deps.logger.log("warn", "Failed to create SchedulingFairnessMonitor.", {
            error,
            type : "createInstrumentedSchedulingFairness",
        });
        return { name : "scheduling-fairness", monitor : undefined, stop : () => {} };
    }
}
