import type { CoreDeps, TimerDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import {
    TimerThrottleDetector,
    type TimerThrottleConfig,
} from "../TimerThrottleDetector.js";
import { createHandle, observe } from "./shared.js";

export type ThrottleDetectorDeps = CoreDeps & Pick<TimerDeps, "setTimeoutFn" | "clearTimeoutFn"> & {
    throttleConfig? : TimerThrottleConfig;
};

/**
 * Constructs a TimerThrottleDetector wired to a throttle-state gauge.
 *
 * Metric:
 * - `lag_timer_throttled_gauge` — 1 if timers are being throttled, 0 otherwise
 *
 * Deliberately not paused while hidden: detecting background throttling is
 * the point.
 */
export function createInstrumentedThrottleDetector(
    deps : ThrottleDetectorDeps,
) : MonitorHandle<TimerThrottleDetector> {
    return createHandle("throttle-detector", deps.logger, () => {
        const monitor = new TimerThrottleDetector(
            deps.setTimeoutFn,
            deps.clearTimeoutFn,
            deps.clock,
            deps.logger,
            deps.throttleConfig,
        );
        monitor.start();

        const unobserve = observe(
            deps.meter.createObservableGauge("lag_timer_throttled_gauge", { unit : "1" }),
            (result) => { result.observe(monitor.isThrottled() ? 1 : 0); },
        );

        return {
            monitor,
            stop : () => {
                unobserve();
                monitor.stop();
            },
        };
    });
}
