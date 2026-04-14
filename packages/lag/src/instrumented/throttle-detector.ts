import type { Logger, Clock, SetTimeoutFn } from "../types.js";
import type { MonitorHandle } from "../monitor-handle.js";
import type { Meter } from "../meter.js";
import {
    TimerThrottleDetector,
    type TimerThrottleConfig,
} from "../TimerThrottleDetector.js";

/**
 * Constructs a TimerThrottleDetector wired to a throttle-state gauge.
 *
 * Metric:
 * - `lag_timer_throttled_gauge` — 1 if timers are being throttled, 0 otherwise
 *
 * No histogram — throttle detection is a calibration-based boolean, not a
 * per-sample measurement.
 */
export type ThrottleDetectorDeps = {
    logger : Logger;
    clock : Clock;
    meter : Meter;
    setTimeoutFn : SetTimeoutFn;
    config? : TimerThrottleConfig;
};

export function createInstrumentedThrottleDetector(
    deps : ThrottleDetectorDeps,
) : MonitorHandle<TimerThrottleDetector> {
    try {
        const throttledGauge = deps.meter.createObservableGauge<Record<string, never>>(
            "lag_timer_throttled_gauge", { unit : "1" });

        const monitor = new TimerThrottleDetector(
            deps.setTimeoutFn,
            deps.clock,
            deps.logger,
            deps.config ?? {},
        );
        monitor.start();

        throttledGauge.addCallback((result) => {
            result.observe(monitor.isThrottled() ? 1 : 0);
        });

        return { name : "throttle-detector", monitor, stop : () => monitor.stop() };
    } catch (error) {
        deps.logger.log("warn", "Failed to create TimerThrottleDetector.", {
            error,
            type : "createInstrumentedThrottleDetector",
        });
        return { name : "throttle-detector", monitor : undefined, stop : () => {} };
    }
}
