import type { CoreDeps, ObserverDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { PaintTimingMonitor } from "../PaintTimingMonitor.js";
import { createHandle, observe } from "./shared.js";

/**
 * Constructs a PaintTimingMonitor wired to two gauges (one-shot metrics).
 *
 * Metrics (ms since navigation start, observed once the entry has arrived):
 * - `lag_paint_first_paint_gauge` — FP (first paint)
 * - `lag_paint_first_contentful_paint_gauge` — FCP
 */
export function createInstrumentedPaintTiming(
    deps : CoreDeps & ObserverDeps,
) : MonitorHandle<PaintTimingMonitor> {
    return createHandle("paint-timing", deps.logger, () => {
        const monitor = new PaintTimingMonitor(
            () => { /* values read via gauge callbacks */ },
            deps.logger,
            deps.PerformanceObserver,
        );

        const disposers = [
            observe(
                deps.meter.createObservableGauge("lag_paint_first_paint_gauge", { unit : "ms" }),
                (result) => {
                    const v = monitor.getFirstPaint();
                    if (v >= 0) result.observe(v);
                },
            ),
            observe(
                deps.meter.createObservableGauge("lag_paint_first_contentful_paint_gauge", { unit : "ms" }),
                (result) => {
                    const v = monitor.getFirstContentfulPaint();
                    if (v >= 0) result.observe(v);
                },
            ),
        ];

        return {
            monitor,
            stop : () => {
                for (const dispose of disposers) dispose();
                monitor.stop();
            },
        };
    });
}
