import type { CoreDeps, TimerDeps, MemoryDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import {
    MemoryMonitor,
    defaultMemoryIntervalMs,
    type MemoryMeasurement,
} from "../MemoryMonitor.js";
import { METRICS, createHistogram } from "../metric-catalog.js";
import { createHandle } from "./shared.js";

/**
 * Constructs a MemoryMonitor wired to two histograms:
 * - `lag_memory_used_bytes_histogram`, labeled with `source` ("modern" or
 *   "legacy": they measure different things)
 * - `lag_memory_usage_ratio_histogram`, the used heap divided by the heap
 *   limit (legacy source only)
 *
 * MemoryMonitor prefers `measureUserAgentSpecificMemory()` (requires
 * cross-origin isolation) and falls back to Chrome's `performance.memory`.
 */
export function createInstrumentedMemory(
    deps : CoreDeps & MemoryDeps & Pick<TimerDeps, "setIntervalFn" | "clearIntervalFn">,
) : MonitorHandle<MemoryMonitor> {
    return createHandle("memory", deps.logger, () => {
        const usedHist = createHistogram<{ source : MemoryMeasurement["source"] }>(deps.meter, METRICS.memoryUsed);
        const usageHist = createHistogram(deps.meter, METRICS.memoryUsage);

        const monitor = new MemoryMonitor(
            deps.memoryIntervalMs ?? defaultMemoryIntervalMs,
            deps.memorySource,
            (m) => {
                usedHist.record(m.usedBytes, { source : m.source });
                if (m.usagePercent !== undefined) usageHist.record(m.usagePercent / 100);
            },
            deps.logger,
            deps.setIntervalFn,
            deps.clearIntervalFn,
            deps.clock,
        );

        return { monitor, stop : () => monitor.stop() };
    });
}
