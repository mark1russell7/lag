import type { CoreDeps, GCDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { GCSignalDetector } from "../GCSignalDetector.js";
import { createHandle, observe } from "./shared.js";

const GC_RATE_WINDOW_MS = 60_000;

/**
 * Constructs a GCSignalDetector wired to an event counter + rate gauge.
 *
 * Metrics:
 * - `lag_gc_events` — +1 per observed GC cycle, counted when the engine runs
 *   the finalization callback
 * - `lag_gc_recent_rate_gauge` — GC cycles observed in the last 60 seconds
 */
export function createInstrumentedGCSignal(
    deps : CoreDeps & GCDeps,
) : MonitorHandle<GCSignalDetector> {
    return createHandle("gc-signal", deps.logger, () => {
        const events = deps.meter.createCounter("lag_gc_events", { unit : "{gc}" });

        const monitor = new GCSignalDetector(
            deps.FinalizationRegistry,
            deps.clock,
            deps.logger,
            () => events.add(1),
        );

        const unobserve = observe(
            deps.meter.createObservableGauge("lag_gc_recent_rate_gauge", { unit : "events" }),
            (result) => { result.observe(monitor.getRecentGCEvents(GC_RATE_WINDOW_MS)); },
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
