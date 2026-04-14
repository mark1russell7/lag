import type { CoreDeps, ClockReliabilityDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { ClockReliabilityChecker } from "../ClockReliabilityChecker.js";

/**
 * Constructs a ClockReliabilityChecker wired to one gauge.
 *
 * Metric:
 * - `lag_clock_resolution_gauge` — detected `performance.now()` resolution (ms)
 *
 * The resolution is measured once at construction (100 samples in a tight
 * loop, ~1ms of work) and cached via the gauge callback re-reading it.
 * Cross-origin-isolated contexts report ≤5μs; non-isolated contexts
 * typically report ~100μs (the Spectre mitigation clamp).
 */
export function createInstrumentedClockReliability(
    deps : CoreDeps & ClockReliabilityDeps,
) : MonitorHandle<ClockReliabilityChecker> {
    try {
        const resolutionGauge = deps.meter.createObservableGauge<Record<string, never>>(
            "lag_clock_resolution_gauge", { unit : "ms" });

        const checker = new ClockReliabilityChecker(deps.performance);

        resolutionGauge.addCallback((result) => {
            result.observe(checker.getResolutionMs());
        });

        return {
            name : "clock-reliability",
            monitor : checker,
            stop : () => { /* no resources to release */ },
        };
    } catch (error) {
        deps.logger.log("warn", "Failed to create ClockReliabilityChecker.", {
            error,
            type : "createInstrumentedClockReliability",
        });
        return { name : "clock-reliability", monitor : undefined, stop : () => {} };
    }
}
