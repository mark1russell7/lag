import type { CoreDeps, PerformanceDeps, TimerDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { ClockReliabilityChecker } from "../ClockReliabilityChecker.js";
import { METRICS, createHistogram } from "../metric-catalog.js";
import { createHandle } from "./shared.js";

/** Measure after page load work has settled; the measurement reads the clock in a tight loop. */
const MEASURE_DELAY_MS = 5_000;

/**
 * Constructs a ClockReliabilityChecker wired to
 * `lag_clock_resolution_histogram`: one sample for each page, 5 seconds after
 * setup. Cross-origin-isolated contexts report 20 μs or less; other contexts
 * report 100 μs to 1 ms (the Spectre mitigation).
 */
export function createInstrumentedClockReliability(
    deps : CoreDeps & PerformanceDeps & Pick<TimerDeps, "setTimeoutFn" | "clearTimeoutFn">,
) : MonitorHandle<ClockReliabilityChecker> {
    return createHandle("clock-reliability", deps.logger, () => {
        const resolutionHist = createHistogram(deps.meter, METRICS.clockResolution);
        const checker = new ClockReliabilityChecker(deps.performance);

        const handle = deps.setTimeoutFn(() => {
            const resolution = checker.getResolutionMs();
            if (resolution > 0) resolutionHist.record(resolution);
        }, MEASURE_DELAY_MS);

        return { monitor : checker, stop : () => deps.clearTimeoutFn(handle) };
    });
}
