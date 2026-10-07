import type { CoreDeps, ObserverDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { LayoutShiftMonitor } from "../LayoutShiftMonitor.js";
import { METRICS, createHistogram } from "../metric-catalog.js";
import { createHandle } from "./shared.js";

/**
 * Constructs a LayoutShiftMonitor wired to `lag_layout_shift_histogram`
 * (the score of each shift that did not follow user input).
 *
 * CLS for each page view comes from the page-view vitals
 * (`createInstrumentedPageViewVitals`), not from this factory.
 */
export function createInstrumentedLayoutShift(
    deps : CoreDeps & ObserverDeps,
) : MonitorHandle<LayoutShiftMonitor> {
    return createHandle("layout-shift", deps.logger, () => {
        const shiftHist = createHistogram(deps.meter, METRICS.layoutShift);

        const monitor = new LayoutShiftMonitor(
            (entry) => { shiftHist.record(entry.value); },
            deps.logger,
            deps.PerformanceObserver,
        );

        return { monitor, stop : () => monitor.stop() };
    });
}
