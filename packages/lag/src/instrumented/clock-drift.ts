import type { CoreDeps, EventDeps, PerformanceDeps, TimerDeps, WallClockDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { ClockDriftMonitor } from "../ClockDriftMonitor.js";
import { EVENTS, METRICS, createCounter, createHistogram } from "../metric-catalog.js";
import { createHandle } from "./shared.js";

/**
 * Constructs a ClockDriftMonitor wired to `lag_clock_skew_histogram` (the
 * absolute skew of each sample) and the `lag_clock_jumps` counter. With
 * `deps.events`, each jump also emits a `lag.clock.jump` event.
 *
 * Not paused while hidden: the device can sleep while the page is hidden.
 */
export function createInstrumentedClockDrift(
    deps : CoreDeps & PerformanceDeps & WallClockDeps & Pick<TimerDeps, "setIntervalFn" | "clearIntervalFn"> & Partial<EventDeps>,
) : MonitorHandle<ClockDriftMonitor> {
    return createHandle("clock-drift", deps.logger, () => {
        const skewHist = createHistogram(deps.meter, METRICS.clockSkew);
        const jumps = createCounter<{ direction : "forward" | "backward" }>(deps.meter, METRICS.clockJumps);

        const monitor = new ClockDriftMonitor(
            ({ skewMs }) => skewHist.record(Math.abs(skewMs)),
            (jump) => {
                jumps.add(1, { direction : jump.direction });
                deps.events?.emit(EVENTS.clockJump.name, {
                    direction : jump.direction,
                    magnitude_ms : jump.magnitudeMs,
                    skew_ms : jump.skewMs,
                });
            },
            deps.logger,
            deps.performance,
            deps.wallClock,
            deps.setIntervalFn,
            deps.clearIntervalFn,
        );

        return { monitor, stop : () => monitor.stop() };
    });
}
