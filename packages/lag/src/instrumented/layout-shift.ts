import type { CoreDeps, ObserverDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { LayoutShiftMonitor, type LayoutShiftReport } from "../LayoutShiftMonitor.js";

/**
 * Constructs a LayoutShiftMonitor wired to a shift histogram and a
 * session-worst CLS gauge.
 *
 * Metrics:
 * - `lag_cls_shift_histogram` — per-shift value (unitless score)
 * - `lag_cls_worst_session_gauge` — running worst session CLS value
 */
export function createInstrumentedLayoutShift(
    deps : CoreDeps & ObserverDeps,
) : MonitorHandle<LayoutShiftMonitor> {
    try {
        const shiftHist = deps.meter.createHistogram<LayoutShiftReport>(
            "lag_cls_shift_histogram", { unit : "score" });
        const worstGauge = deps.meter.createObservableGauge<Record<string, never>>(
            "lag_cls_worst_session_gauge", { unit : "score" });

        const monitor = new LayoutShiftMonitor(
            (entry) => {
                shiftHist.record(entry.value, entry);
            },
            deps.logger,
            deps.PerformanceObserver,
        );

        worstGauge.addCallback((result) => {
            result.observe(monitor.getCLS());
        });

        return { name : "layout-shift", monitor, stop : () => monitor.stop() };
    } catch (error) {
        deps.logger.log("warn", "Failed to create LayoutShiftMonitor.", {
            error,
            type : "createInstrumentedLayoutShift",
        });
        return { name : "layout-shift", monitor : undefined, stop : () => {} };
    }
}
