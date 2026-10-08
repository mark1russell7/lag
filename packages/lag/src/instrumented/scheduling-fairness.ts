import type { CoreDeps, TimerDeps, SchedulingDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { SchedulingFairnessMonitor, type SchedulingMeasurement } from "../SchedulingFairnessMonitor.js";
import type { MeasurementConditions } from "../measurement-conditions.js";
import { METRICS, createHistogram } from "../metric-catalog.js";
import { createHandle } from "./shared.js";

const DEFAULT_INTERVAL_MS = 5_000;

/**
 * This factory makes a `SchedulingFairnessMonitor` that records into three
 * histograms: the latency of `queueMicrotask` (a near-zero baseline), of
 * `setTimeout(0)` and of `MessageChannel`. To read them together, refer to
 * `SchedulingFairnessMonitor`. With `conditions`, the monitor pauses while
 * the page is hidden. Also, it does not record a cycle that overlaps an
 * unreliable interval.
 */
export function createInstrumentedSchedulingFairness(
    deps : CoreDeps & TimerDeps & SchedulingDeps,
    conditions? : MeasurementConditions,
    intervalMs : number = DEFAULT_INTERVAL_MS,
) : MonitorHandle<SchedulingFairnessMonitor> {
    return createHandle("scheduling-fairness", deps.logger, () => {
        const microHist = createHistogram(deps.meter, METRICS.schedulingMicrotask);
        const macroHist = createHistogram(deps.meter, METRICS.schedulingMacrotask);
        const channelHist = createHistogram(deps.meter, METRICS.schedulingMessageChannel);
        const validator = conditions?.createValidator();

        const record = (m : SchedulingMeasurement) : void => {
            microHist.record(m.microtaskMs);
            macroHist.record(m.macrotaskMs);
            channelHist.record(m.messageChannelMs);
        };

        const monitor = new SchedulingFairnessMonitor(
            intervalMs,
            (m) => {
                const windowMs = Math.max(m.macrotaskMs, m.messageChannelMs, m.microtaskMs);
                if (validator) validator.submit(windowMs, windowMs, () => record(m));
                else record(m);
            },
            deps.logger,
            deps.setIntervalFn,
            deps.clearIntervalFn,
            deps.setTimeoutFn,
            deps.queueMicrotask,
            deps.MessageChannel,
            deps.clock,
        );
        const unpause = conditions?.pauseWhileHidden(monitor);

        return {
            monitor,
            stop : () => {
                unpause?.();
                monitor.stop();
                validator?.dispose();
            },
        };
    });
}
