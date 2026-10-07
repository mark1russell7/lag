import type { CoreDeps, PressureDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import {
    ComputePressureMonitor,
    type PressureSource,
} from "../ComputePressureMonitor.js";
import { createHandle, observe } from "./shared.js";

const DEFAULT_SAMPLE_INTERVAL_MS = 1_000;

/**
 * Constructs a ComputePressureMonitor wired to one gauge + one histogram.
 *
 * Metrics (ordinal: 0=nominal, 1=fair, 2=serious, 3=critical):
 * - `lag_pressure_state_gauge` — worst current state across observed sources
 * - `lag_pressure_change_histogram` — every reported state, labeled with `source`
 *
 * Silently degrades on browsers without PressureObserver (currently Chromium
 * only). The monitor itself logs a warning when observe() rejects.
 */
export function createInstrumentedComputePressure(
    deps : CoreDeps & PressureDeps,
) : MonitorHandle<ComputePressureMonitor> {
    return createHandle("compute-pressure", deps.logger, () => {
        const changeHist = deps.meter.createHistogram<{ source : PressureSource }>(
            "lag_pressure_change_histogram", { unit : "ordinal" });

        const monitor = new ComputePressureMonitor(
            deps.pressureSources ?? ["cpu"],
            (m) => { changeHist.record(m.stateOrdinal, { source : m.source }); },
            deps.logger,
            deps.PressureObserver,
            deps.pressureSampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS,
        );

        const unobserve = observe(
            deps.meter.createObservableGauge("lag_pressure_state_gauge", { unit : "ordinal" }),
            (result) => {
                const ord = monitor.getWorstStateOrdinal();
                if (ord >= 0) result.observe(ord);
            },
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
