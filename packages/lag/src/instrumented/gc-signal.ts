import type { CoreDeps, GCDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { GCSignalDetector } from "../GCSignalDetector.js";
import { METRICS, createCounter } from "../metric-catalog.js";
import { createHandle } from "./shared.js";

/**
 * This factory makes a `GCSignalDetector` that records into the
 * `lag_gc_events` counter. The counter increases by 1 for each garbage
 * collection that the detector saw, when the engine starts the finalization
 * callback. The GC rate is `rate(lag_gc_events[1m])`.
 */
export function createInstrumentedGCSignal(
    deps : CoreDeps & GCDeps,
) : MonitorHandle<GCSignalDetector> {
    return createHandle("gc-signal", deps.logger, () => {
        const events = createCounter(deps.meter, METRICS.gcEvents);

        const monitor = new GCSignalDetector(
            deps.FinalizationRegistry,
            deps.clock,
            deps.logger,
            () => events.add(1),
        );

        return { monitor, stop : () => monitor.stop() };
    });
}
