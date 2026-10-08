import type { CoreDeps, PerformanceDeps, TimerDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { ClockReliabilityChecker } from "../ClockReliabilityChecker.js";
import { METRICS, createHistogram } from "../metric-catalog.js";
import { createHandle } from "./shared.js";

/**
 * The factory waits this time before it measures, so that the work of the
 * page load is usually complete. The measurement reads the clock in a tight
 * loop.
 */
const MEASURE_DELAY_MS = 5_000;

/**
 * This factory makes a `ClockReliabilityChecker` that records into
 * `lag_clock_resolution_histogram`: one sample for each page, 5 seconds
 * after the setup. Cross-origin-isolated contexts report 20 μs or less.
 * Other contexts report 100 μs to 1 ms, because of the mitigation of
 * Spectre.
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
