import type { CoreDeps, ObserverDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { LongAnimationFrameMonitor } from "../LongAnimationFrameMonitor.js";
import { createHandle } from "./shared.js";

/**
 * Constructs a LongAnimationFrameMonitor wired to two OTel histograms:
 * - `lag_loaf_blocking_histogram` — blockingDuration (ms) per frame
 * - `lag_loaf_duration_histogram` — total duration (ms) per frame
 */
export function createInstrumentedLoaf(
    deps : CoreDeps & ObserverDeps,
) : MonitorHandle<LongAnimationFrameMonitor> {
    return createHandle("loaf", deps.logger, () => {
        const blockingHist = deps.meter.createHistogram("lag_loaf_blocking_histogram", { unit : "ms" });
        const durationHist = deps.meter.createHistogram("lag_loaf_duration_histogram", { unit : "ms" });

        const monitor = new LongAnimationFrameMonitor(
            (entry) => {
                blockingHist.record(entry.blockingDuration);
                durationHist.record(entry.duration);
            },
            deps.logger,
            deps.PerformanceObserver,
        );

        return { monitor, stop : () => monitor.stop() };
    });
}
