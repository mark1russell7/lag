import type { CoreDeps, SchedulingDeps, TimerDeps } from "../dep-groups.js";
import { createMessageTaskQueue } from "../message-task.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { MacrotaskLag } from "../MacrotaskLag.js";
import type { MeasurementConditions } from "../measurement-conditions.js";
import { macrotaskLagIntervalMs } from "../constants.js";
import { METRICS, createHistogram } from "../metric-catalog.js";
import { createHandle, validatedRecorder } from "./shared.js";

/**
 * This factory makes a `MacrotaskLag` monitor that records into
 * `lag_macrotask_histogram`.
 *
 * `MacrotaskLag` measures how long a `setTimeout(0)` waits in the task
 * queue. The value is an indirect measure of the queue depth. The monitor
 * samples every 5 seconds. This rate is too low for the `LagLogger` windows,
 * but `DriftLag` covers those windows.
 *
 * With `conditions`, the monitor pauses while the page is hidden, and it
 * does not record the samples that are not valid. With
 * `deps.MessageChannel`, each measurement starts in a message task. Thus,
 * the 4 ms clamp of nested timers does not apply.
 */
export function createInstrumentedMacrotaskLag(
    deps : CoreDeps & TimerDeps & Partial<Pick<SchedulingDeps, "MessageChannel">>,
    conditions? : MeasurementConditions,
) : MonitorHandle<MacrotaskLag> {
    return createHandle("macrotask-lag", deps.logger, () => {
        const histogram = createHistogram(deps.meter, METRICS.macrotask);
        const recorder = validatedRecorder(conditions, (lag) => histogram.record(lag));
        const tasks = deps.MessageChannel ? createMessageTaskQueue(deps.MessageChannel) : undefined;

        const monitor = new MacrotaskLag(
            macrotaskLagIntervalMs,
            (value : number) => {
                const lag = Math.max(0, value);
                recorder.submit(lag, lag);
            },
            deps.logger,
            deps.setIntervalFn,
            deps.clearIntervalFn,
            deps.setTimeoutFn,
            deps.clearTimeoutFn,
            deps.clock,
            tasks ? (callback) => tasks.post(callback) : undefined,
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
