import type { CoreDeps, ObserverDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { LcpMonitor } from "../LcpMonitor.js";

/**
 * Constructs an LcpMonitor wired to a single observable gauge.
 *
 * Metric:
 * - `lag_lcp_gauge` — largest-contentful-paint time (ms since navigation)
 *
 * LCP updates multiple times during page load as larger candidates appear.
 * The gauge reports the latest value each collection cycle.
 */
export function createInstrumentedLcp(
    deps : CoreDeps & ObserverDeps,
) : MonitorHandle<LcpMonitor> {
    try {
        const lcpGauge = deps.meter.createObservableGauge<Record<string, never>>(
            "lag_lcp_gauge", { unit : "ms" });

        const monitor = new LcpMonitor(
            () => { /* values read via gauge callback */ },
            deps.logger,
            deps.PerformanceObserver,
        );

        lcpGauge.addCallback((result) => {
            const v = monitor.getLCP();
            if (v > 0) result.observe(v);
        });

        return { name : "lcp", monitor, stop : () => monitor.stop() };
    } catch (error) {
        deps.logger.log("warn", "Failed to create LcpMonitor.", {
            error,
            type : "createInstrumentedLcp",
        });
        return { name : "lcp", monitor : undefined, stop : () => {} };
    }
}
