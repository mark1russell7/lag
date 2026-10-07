import type { CoreDeps, TimerDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import {
    TimerThrottleDetector,
    type TimerThrottleConfig,
} from "../TimerThrottleDetector.js";
import { METRICS, createCounter } from "../metric-catalog.js";
import { createHandle } from "./shared.js";

export type ThrottleDetectorDeps = CoreDeps & Pick<TimerDeps, "setTimeoutFn" | "clearTimeoutFn"> & {
    throttleConfig? : TimerThrottleConfig;
};

/**
 * Constructs a TimerThrottleDetector wired to the `lag_timer_calibrations`
 * counter, labeled with `throttled`. The fraction of throttled rounds is
 * `rate(lag_timer_calibrations{throttled="true"})` divided by the rate of
 * all rounds.
 *
 * Deliberately not paused while hidden: detecting background throttling is
 * the point.
 */
export function createInstrumentedThrottleDetector(
    deps : ThrottleDetectorDeps,
) : MonitorHandle<TimerThrottleDetector> {
    return createHandle("throttle-detector", deps.logger, () => {
        const calibrations = createCounter<{ throttled : "true" | "false" }>(deps.meter, METRICS.timerCalibrations);

        const monitor = new TimerThrottleDetector(
            ({ throttled }) => calibrations.add(1, { throttled : throttled ? "true" : "false" }),
            deps.setTimeoutFn,
            deps.clearTimeoutFn,
            deps.clock,
            deps.logger,
            deps.throttleConfig,
        );
        monitor.start();

        return { monitor, stop : () => monitor.stop() };
    });
}
