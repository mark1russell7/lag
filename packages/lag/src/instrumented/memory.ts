import type { CoreDeps, TimerDeps, MemoryDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import {
    MemoryMonitor,
    defaultMemoryIntervalMs,
    type MemoryMeasurement,
} from "../MemoryMonitor.js";
import { createHandle, observe } from "./shared.js";

/**
 * Constructs a MemoryMonitor wired to one histogram + one gauge.
 *
 * Metrics:
 * - `lag_memory_used_bytes_histogram` — heap bytes per sample, labeled with
 *   `source` ("modern" or "legacy": they measure different things)
 * - `lag_memory_usage_percent_gauge` — used/limit percentage (legacy API only)
 *
 * MemoryMonitor prefers `measureUserAgentSpecificMemory()` (requires
 * cross-origin isolation) and falls back to Chrome's `performance.memory`.
 */
export function createInstrumentedMemory(
    deps : CoreDeps & MemoryDeps & Pick<TimerDeps, "setIntervalFn" | "clearIntervalFn">,
) : MonitorHandle<MemoryMonitor> {
    return createHandle("memory", deps.logger, () => {
        const usedHist = deps.meter.createHistogram<{ source : MemoryMeasurement["source"] }>(
            "lag_memory_used_bytes_histogram", { unit : "By" });

        let lastMeasurement : MemoryMeasurement | undefined;

        const monitor = new MemoryMonitor(
            deps.memoryIntervalMs ?? defaultMemoryIntervalMs,
            deps.memorySource,
            (m) => {
                usedHist.record(m.usedBytes, { source : m.source });
                lastMeasurement = m;
            },
            deps.logger,
            deps.setIntervalFn,
            deps.clearIntervalFn,
            deps.clock,
        );

        const unobserve = observe(
            deps.meter.createObservableGauge("lag_memory_usage_percent_gauge", { unit : "%" }),
            (result) => {
                if (lastMeasurement?.usagePercent !== undefined) {
                    result.observe(lastMeasurement.usagePercent);
                }
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
