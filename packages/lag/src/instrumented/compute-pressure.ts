import type { AbsoluteClockDeps, CoreDeps, EventDeps, PerformanceDeps, PressureDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import {
    ComputePressureMonitor,
    type PressureSource,
    type PressureState,
} from "../ComputePressureMonitor.js";
import { EVENTS, METRICS, createHistogram } from "../metric-catalog.js";
import { createHandle, eventClock, occurredAt } from "./shared.js";

const DEFAULT_SAMPLE_INTERVAL_MS = 1_000;

/**
 * This factory makes a `ComputePressureMonitor` that records into
 * `lag_pressure_state_histogram`, with the attribute `source`. The value is
 * the state ordinal of each record: 0 nominal, 1 fair, 2 serious, 3
 * critical. With an event sink, each change of the state of a source also
 * emits a `lag.pressure.change` event at the time of the record. A record
 * with the same state as the last record of its source emits no event.
 *
 * In a browser without `PressureObserver`, the monitor records nothing, and
 * it does not throw an error. At this time, only Chromium on desktop has
 * `PressureObserver`. The monitor itself logs a warning when the observer
 * is not available or when `observe()` rejects.
 */
export function createInstrumentedComputePressure(
    deps : CoreDeps & PressureDeps & Partial<EventDeps> & Partial<AbsoluteClockDeps> & Partial<PerformanceDeps>,
) : MonitorHandle<ComputePressureMonitor> {
    return createHandle("compute-pressure", deps.logger, () => {
        const stateHist = createHistogram<{ source : PressureSource }>(deps.meter, METRICS.pressureState);
        const clock = eventClock(deps);
        const lastStates = new Map<PressureSource, PressureState>();

        const monitor = new ComputePressureMonitor(
            deps.pressureSources ?? ["cpu"],
            (m) => {
                stateHist.record(m.stateOrdinal, { source : m.source });
                const previous = lastStates.get(m.source);
                if (previous === m.state) return;
                lastStates.set(m.source, m.state);
                deps.events?.emit(EVENTS.pressureChange.name, {
                    source : m.source,
                    state : m.state,
                    ...(previous ? { previous_state : previous } : {}),
                }, occurredAt(clock, m.timestamp));
            },
            deps.logger,
            deps.PressureObserver,
            deps.pressureSampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS,
        );

        return { monitor, stop : () => monitor.stop() };
    });
}
