import type { CoreDeps, ObserverDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { LayoutShiftMonitor } from "../LayoutShiftMonitor.js";
import { createHandle, observe } from "./shared.js";

/**
 * Constructs a LayoutShiftMonitor wired to a shift histogram and a
 * session-worst CLS gauge.
 *
 * Metrics:
 * - `lag_cls_shift_histogram` — per-shift value (unitless score)
 * - `lag_cls_worst_session_gauge` — CLS: the worst session window so far
 */
export function createInstrumentedLayoutShift(
    deps : CoreDeps & ObserverDeps,
) : MonitorHandle<LayoutShiftMonitor> {
    return createHandle("layout-shift", deps.logger, () => {
        const shiftHist = deps.meter.createHistogram("lag_cls_shift_histogram", { unit : "score" });

        const monitor = new LayoutShiftMonitor(
            (entry) => { shiftHist.record(entry.value); },
            deps.logger,
            deps.PerformanceObserver,
        );

        const unobserve = observe(
            deps.meter.createObservableGauge("lag_cls_worst_session_gauge", { unit : "score" }),
            (result) => { result.observe(monitor.getCLS()); },
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
