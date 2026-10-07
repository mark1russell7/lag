import type { CoreDeps, PressureDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import {
    ComputePressureMonitor,
    type PressureSource,
} from "../ComputePressureMonitor.js";
import { METRICS, createHistogram } from "../metric-catalog.js";
import { createHandle } from "./shared.js";

const DEFAULT_SAMPLE_INTERVAL_MS = 1_000;

/**
 * This factory makes a `ComputePressureMonitor` that records into
 * `lag_pressure_state_histogram`, with the attribute `source`. The value is
 * the state ordinal of each record: 0 nominal, 1 fair, 2 serious, 3
 * critical.
 *
 * In a browser without `PressureObserver`, the monitor records nothing, and
 * it does not throw an error. At this time, only Chromium on desktop has
 * `PressureObserver`. The monitor itself logs a warning when the observer
 * is not available or when `observe()` rejects.
 */
export function createInstrumentedComputePressure(
    deps : CoreDeps & PressureDeps,
) : MonitorHandle<ComputePressureMonitor> {
    return createHandle("compute-pressure", deps.logger, () => {
        const stateHist = createHistogram<{ source : PressureSource }>(deps.meter, METRICS.pressureState);

        const monitor = new ComputePressureMonitor(
            deps.pressureSources ?? ["cpu"],
            (m) => { stateHist.record(m.stateOrdinal, { source : m.source }); },
            deps.logger,
            deps.PressureObserver,
            deps.pressureSampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS,
        );

        return { monitor, stop : () => monitor.stop() };
    });
}
