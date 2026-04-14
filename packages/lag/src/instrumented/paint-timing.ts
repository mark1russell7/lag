import type { CoreDeps, ObserverDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { PaintTimingMonitor } from "../PaintTimingMonitor.js";

/**
 * Constructs a PaintTimingMonitor wired to two gauges (one-shot metrics).
 *
 * Metrics:
 * - `lag_paint_first_paint_gauge` — FP (first paint)
 * - `lag_paint_first_contentful_paint_gauge` — FCP
 *
 * Both gauges emit only once the corresponding event fires (returns -1 until
 * then, which the gauge callback filters out).
 */
export function createInstrumentedPaintTiming(
    deps : CoreDeps & ObserverDeps,
) : MonitorHandle<PaintTimingMonitor> {
    try {
        const fpGauge = deps.meter.createObservableGauge<Record<string, never>>(
            "lag_paint_first_paint_gauge", { unit : "ms" });
        const fcpGauge = deps.meter.createObservableGauge<Record<string, never>>(
            "lag_paint_first_contentful_paint_gauge", { unit : "ms" });

        const monitor = new PaintTimingMonitor(
            () => { /* values read via gauge callbacks */ },
            deps.logger,
            deps.PerformanceObserver,
        );

        fpGauge.addCallback((result) => {
            const v = monitor.getFirstPaint();
            if (v >= 0) result.observe(v);
        });
        fcpGauge.addCallback((result) => {
            const v = monitor.getFirstContentfulPaint();
            if (v >= 0) result.observe(v);
        });

        return { name : "paint-timing", monitor, stop : () => monitor.stop() };
    } catch (error) {
        deps.logger.log("warn", "Failed to create PaintTimingMonitor.", {
            error,
            type : "createInstrumentedPaintTiming",
        });
        return { name : "paint-timing", monitor : undefined, stop : () => {} };
    }
}
