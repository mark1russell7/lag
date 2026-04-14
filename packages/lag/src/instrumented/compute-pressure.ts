import type { CoreDeps, PressureDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import {
    ComputePressureMonitor,
    type PressureMeasurement,
} from "../ComputePressureMonitor.js";

const DEFAULT_SAMPLE_INTERVAL_MS = 1_000;

/**
 * Constructs a ComputePressureMonitor wired to one gauge + one histogram.
 *
 * Metrics (ordinal: 0=nominal, 1=fair, 2=serious, 3=critical):
 * - `lag_pressure_state_gauge` — worst current state across observed sources
 * - `lag_pressure_change_histogram` — every reported state change
 *
 * Silently degrades on browsers without PressureObserver (currently Chrome
 * 125+ only). The monitor itself logs a warning when observe() rejects.
 */
export function createInstrumentedComputePressure(
    deps : CoreDeps & PressureDeps,
) : MonitorHandle<ComputePressureMonitor> {
    try {
        const stateGauge = deps.meter.createObservableGauge<Record<string, never>>(
            "lag_pressure_state_gauge", { unit : "ordinal" });
        const changeHist = deps.meter.createHistogram<PressureMeasurement>(
            "lag_pressure_change_histogram", { unit : "ordinal" });

        const monitor = new ComputePressureMonitor(
            deps.pressureSources ?? ["cpu"],
            (m) => { changeHist.record(m.stateOrdinal, m); },
            deps.logger,
            deps.PressureObserver,
            deps.pressureSampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS,
        );

        stateGauge.addCallback((result) => {
            const ord = monitor.getWorstStateOrdinal();
            if (ord >= 0) result.observe(ord);
        });

        return { name : "compute-pressure", monitor, stop : () => monitor.stop() };
    } catch (error) {
        deps.logger.log("warn", "Failed to create ComputePressureMonitor.", {
            error,
            type : "createInstrumentedComputePressure",
        });
        return { name : "compute-pressure", monitor : undefined, stop : () => {} };
    }
}
