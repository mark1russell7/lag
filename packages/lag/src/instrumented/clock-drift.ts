import type { AbsoluteClockDeps, CoreDeps, EventDeps, PerformanceDeps, TimerDeps, WallClockDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { ClockDriftMonitor, type ClockJump } from "../ClockDriftMonitor.js";
import { createAbsoluteClock } from "../absolute-clock.js";
import { EVENTS, METRICS, createCounter, createHistogram } from "../metric-catalog.js";
import { createHandle } from "./shared.js";

/**
 * This factory makes a `ClockDriftMonitor` that records into
 * `lag_clock_skew_histogram` (the absolute skew of each sample) and into the
 * `lag_clock_jumps` counter, with the attributes `direction` and `kind`.
 * With `deps.events`, each discontinuity also sends a `lag.clock.jump` event.
 *
 * The monitor does not pause while the page is hidden, because the device
 * can sleep while the page is hidden.
 */
export function createInstrumentedClockDrift(
    deps : CoreDeps & PerformanceDeps & Partial<AbsoluteClockDeps> & WallClockDeps & Pick<TimerDeps, "setIntervalFn" | "clearIntervalFn"> & Partial<EventDeps>,
) : MonitorHandle<ClockDriftMonitor> {
    return createHandle("clock-drift", deps.logger, () => {
        const skewHist = createHistogram(deps.meter, METRICS.clockSkew);
        const jumps = createCounter<{ direction : ClockJump["direction"]; kind : ClockJump["kind"] }>(deps.meter, METRICS.clockJumps);

        const monitor = new ClockDriftMonitor(
            ({ skewMs }) => skewHist.record(Math.abs(skewMs)),
            (jump) => {
                jumps.add(1, { direction : jump.direction, kind : jump.kind });
                deps.events?.emit(EVENTS.clockJump.name, {
                    direction : jump.direction,
                    kind : jump.kind,
                    magnitude_ms : jump.magnitudeMs,
                    skew_ms : jump.skewMs,
                    lateness_ms : jump.latenessMs,
                });
            },
            deps.logger,
            deps.absoluteClock ?? createAbsoluteClock(deps.performance),
            deps.wallClock,
            deps.setIntervalFn,
            deps.clearIntervalFn,
        );

        return { monitor, stop : () => monitor.stop() };
    });
}
