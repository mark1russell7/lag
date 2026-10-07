import type { CoreDeps, PerformanceDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { ClockReliabilityChecker } from "../ClockReliabilityChecker.js";
import { createHandle, observe } from "./shared.js";

/**
 * Constructs a ClockReliabilityChecker wired to one gauge.
 *
 * Metric:
 * - `lag_clock_resolution_gauge` — detected `performance.now()` resolution (ms)
 *
 * Measured once, on the first collection, then cached. Cross-origin-isolated
 * contexts report ≤20μs; others report 100μs–1ms (the Spectre mitigation).
 */
export function createInstrumentedClockReliability(
    deps : CoreDeps & PerformanceDeps,
) : MonitorHandle<ClockReliabilityChecker> {
    return createHandle("clock-reliability", deps.logger, () => {
        const checker = new ClockReliabilityChecker(deps.performance);

        const unobserve = observe(
            deps.meter.createObservableGauge("lag_clock_resolution_gauge", { unit : "ms" }),
            (result) => {
                const resolution = checker.getResolutionMs();
                if (resolution > 0) result.observe(resolution);
            },
        );

        return { monitor : checker, stop : unobserve };
    });
}
