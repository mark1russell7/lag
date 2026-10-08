import type { CoreDeps, EventDeps, ObserverDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { LongAnimationFrameMonitor } from "../LongAnimationFrameMonitor.js";
import { EVENTS, METRICS, createHistogram } from "../metric-catalog.js";
import { RateLimiter, stripUrlParameters } from "../rate-limiter.js";
import { createHandle } from "./shared.js";

/** Frames that block at least this long get an attribution event. */
const ATTRIBUTION_THRESHOLD_MS = 150;
const MAX_EVENTS_PER_MINUTE = 10;

/**
 * This factory makes a `LongAnimationFrameMonitor` that records into two
 * histograms (`lag_loaf_blocking_histogram` and
 * `lag_loaf_duration_histogram`).
 *
 * With `deps.events`, a frame that blocks for 150 ms or more also emits a
 * `lag.long_animation_frame` event that names the longest script. The
 * factory sends no more than 10 events each minute.
 */
export function createInstrumentedLoaf(
    deps : CoreDeps & ObserverDeps & Partial<EventDeps>,
) : MonitorHandle<LongAnimationFrameMonitor> {
    return createHandle("loaf", deps.logger, () => {
        const blockingHist = createHistogram(deps.meter, METRICS.loafBlocking);
        const durationHist = createHistogram(deps.meter, METRICS.loafDuration);
        const limiter = new RateLimiter(deps.clock, MAX_EVENTS_PER_MINUTE, 60_000);

        const monitor = new LongAnimationFrameMonitor(
            (entry) => {
                blockingHist.record(entry.blockingDuration);
                durationHist.record(entry.duration);
                if (deps.events && entry.blockingDuration >= ATTRIBUTION_THRESHOLD_MS && limiter.tryAcquire()) {
                    const script = entry.topScript;
                    deps.events.emit(EVENTS.longAnimationFrame.name, {
                        duration_ms : entry.duration,
                        blocking_duration_ms : entry.blockingDuration,
                        ...(script ? {
                            "script.invoker" : script.invoker,
                            "script.invoker_type" : script.invokerType,
                            "script.source_url" : stripUrlParameters(script.sourceURL),
                            "script.duration_ms" : script.duration,
                        } : {}),
                    });
                }
            },
            deps.logger,
            deps.PerformanceObserver,
        );

        return { monitor, stop : () => monitor.stop() };
    });
}
