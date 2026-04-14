import type { CoreDeps, TimerDeps, MemoryDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import {
    MemoryMonitor,
    defaultMemoryIntervalMs,
    type MemoryMeasurement,
} from "../MemoryMonitor.js";

/**
 * Constructs a MemoryMonitor wired to one histogram + one gauge.
 *
 * Metrics:
 * - `lag_memory_used_bytes_histogram` — JS heap used bytes (per sample)
 * - `lag_memory_usage_percent_gauge` — used/limit percentage (legacy API only)
 *
 * MemoryMonitor auto-picks modern `measureUserAgentSpecificMemory()` when
 * available (requires cross-origin isolation) and falls back to legacy
 * `performance.memory` (Chrome-only).
 */
export function createInstrumentedMemory(
    deps : CoreDeps & MemoryDeps & Pick<TimerDeps, "setIntervalFn" | "clearIntervalFn">,
) : MonitorHandle<MemoryMonitor> {
    try {
        const usedHist = deps.meter.createHistogram<MemoryMeasurement>(
            "lag_memory_used_bytes_histogram", { unit : "By" });
        const usageGauge = deps.meter.createObservableGauge<Record<string, never>>(
            "lag_memory_usage_percent_gauge", { unit : "%" });

        let lastMeasurement : MemoryMeasurement | undefined;

        const monitor = new MemoryMonitor(
            deps.memoryIntervalMs ?? defaultMemoryIntervalMs,
            deps.memorySource,
            (m) => {
                usedHist.record(m.usedBytes, m);
                lastMeasurement = m;
            },
            deps.logger,
            deps.setIntervalFn,
            deps.clearIntervalFn,
            deps.clock,
        );

        usageGauge.addCallback((result) => {
            if (lastMeasurement?.usagePercent !== undefined) {
                result.observe(lastMeasurement.usagePercent);
            }
        });

        return { name : "memory", monitor, stop : () => monitor.stop() };
    } catch (error) {
        deps.logger.log("warn", "Failed to create MemoryMonitor.", {
            error,
            type : "createInstrumentedMemory",
        });
        return { name : "memory", monitor : undefined, stop : () => {} };
    }
}
