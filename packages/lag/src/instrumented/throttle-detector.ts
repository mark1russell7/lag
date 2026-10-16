import type { CoreDeps, SchedulingDeps, TimerDeps } from "../dep-groups.js";
import { createMessageTaskQueue } from "../message-task.js";
import type { MonitorHandle } from "../monitor-handle.js";
import {
    TimerThrottleDetector,
    type TimerThrottleConfig,
} from "../TimerThrottleDetector.js";
import { METRICS, createCounter } from "../metric-catalog.js";
import { createHandle } from "./shared.js";

export type ThrottleDetectorDeps = CoreDeps & Pick<TimerDeps, "setTimeoutFn" | "clearTimeoutFn"> & Partial<Pick<SchedulingDeps, "MessageChannel">> & {
    throttleConfig? : TimerThrottleConfig;
};

/**
 * This factory makes a `TimerThrottleDetector` that records into the
 * `lag_timer_calibrations` counter, with the attribute `throttled`. The
 * fraction of throttled rounds is
 * `rate(lag_timer_calibrations{throttled="true"})` divided by the rate of
 * all rounds.
 *
 * With `deps.MessageChannel`, each sample also starts a message task, as a
 * control. Then a block of the main thread does not count as throttling.
 *
 * The detector does not pause while the page is hidden, because its function
 * is to find the throttling of background pages.
 */
export function createInstrumentedThrottleDetector(
    deps : ThrottleDetectorDeps,
) : MonitorHandle<TimerThrottleDetector> {
    return createHandle("throttle-detector", deps.logger, () => {
        const calibrations = createCounter<{ throttled : "true" | "false" }>(deps.meter, METRICS.timerCalibrations);
        const tasks = deps.MessageChannel ? createMessageTaskQueue(deps.MessageChannel) : undefined;

        const monitor = new TimerThrottleDetector(
            ({ throttled }) => calibrations.add(1, { throttled : throttled ? "true" : "false" }),
            deps.setTimeoutFn,
            deps.clearTimeoutFn,
            deps.clock,
            deps.logger,
            deps.throttleConfig,
            tasks ? (callback) => tasks.post(callback) : undefined,
        );
        monitor.start();

        return {
            monitor,
            stop : () => {
                monitor.stop();
                tasks?.close();
            },
        };
    });
}
