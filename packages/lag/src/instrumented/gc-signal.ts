import type { CoreDeps, TimerDeps, GCDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import {
    GCSignalDetector,
    type FinalizationRegistryConstructor,
} from "../GCSignalDetector.js";

const DEFAULT_CANARY_INTERVAL_MS = 250;
const GC_RATE_WINDOW_MS = 60_000;

/**
 * Constructs a GCSignalDetector wired to an event counter + rate gauge.
 *
 * Metrics:
 * - `lag_gc_event_counter_histogram` — records 1 every time a canary is
 *   observed to be collected (i.e., a real GC event occurred)
 * - `lag_gc_recent_rate_gauge` — number of GC events in the last 60 seconds
 *
 * The FinalizationRegistry is wrapped at construction so that every cleanup
 * callback increments the counter before the detector's own bookkeeping
 * runs. This gives us the metric at the moment the engine fires the
 * finalization — not at a later polling interval.
 */
export function createInstrumentedGCSignal(
    deps : CoreDeps & GCDeps & Pick<TimerDeps, "setIntervalFn" | "clearIntervalFn">,
) : MonitorHandle<GCSignalDetector> {
    try {
        const eventCounter = deps.meter.createHistogram<{ source : string }>(
            "lag_gc_event_counter_histogram", { unit : "count" });
        const rateGauge = deps.meter.createObservableGauge<Record<string, never>>(
            "lag_gc_recent_rate_gauge", { unit : "events" });

        // Wrap the FR constructor so every finalization callback increments
        // the counter before the detector's cleanup runs.
        const wrappedFR = function <T>(this : unknown, cleanup : (held : T) => void) {
            return new deps.FinalizationRegistry<T>((held : T) => {
                eventCounter.record(1, { source : "canary" });
                cleanup(held);
            });
        } as unknown as FinalizationRegistryConstructor;

        const monitor = new GCSignalDetector(
            wrappedFR,
            deps.clock,
            deps.setIntervalFn,
            deps.clearIntervalFn,
            deps.logger,
            deps.gcCanaryIntervalMs ?? DEFAULT_CANARY_INTERVAL_MS,
        );

        rateGauge.addCallback((result) => {
            result.observe(monitor.getRecentGCEvents(GC_RATE_WINDOW_MS));
        });

        return { name : "gc-signal", monitor, stop : () => monitor.stop() };
    } catch (error) {
        deps.logger.log("warn", "Failed to create GCSignalDetector.", {
            error,
            type : "createInstrumentedGCSignal",
        });
        return { name : "gc-signal", monitor : undefined, stop : () => {} };
    }
}
