import type { CoreDeps, ObserverDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { LongAnimationFrameMonitor, type LoafReport } from "../LongAnimationFrameMonitor.js";

/**
 * Constructs a LongAnimationFrameMonitor wired to two OTel histograms:
 * - `lag_loaf_blocking_histogram` — blockingDuration (ms) per frame
 * - `lag_loaf_duration_histogram` — total duration (ms) per frame
 *
 * Returns a handle that can be stopped. If construction fails (e.g. the
 * browser doesn't support `long-animation-frame`), returns a handle with
 * `monitor: undefined` and a no-op stop.
 */
export function createInstrumentedLoaf(
    deps : CoreDeps & ObserverDeps,
) : MonitorHandle<LongAnimationFrameMonitor> {
    try {
        const blockingHist = deps.meter.createHistogram<LoafReport>(
            "lag_loaf_blocking_histogram", { unit : "ms" });
        const durationHist = deps.meter.createHistogram<LoafReport>(
            "lag_loaf_duration_histogram", { unit : "ms" });

        const monitor = new LongAnimationFrameMonitor(
            (entry) => {
                blockingHist.record(entry.blockingDuration, entry);
                durationHist.record(entry.duration, entry);
            },
            deps.logger,
            deps.PerformanceObserver,
        );

        return {
            name : "loaf",
            monitor,
            stop : () => monitor.stop(),
        };
    } catch (error) {
        deps.logger.log("warn", "Failed to create LongAnimationFrameMonitor.", {
            error,
            type : "createInstrumentedLoaf",
        });
        return { name : "loaf", monitor : undefined, stop : () => {} };
    }
}
