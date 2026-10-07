import type { CoreDeps, ObserverDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { LcpMonitor } from "../LcpMonitor.js";
import { createHandle, observe } from "./shared.js";

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
    return createHandle("lcp", deps.logger, () => {
        const monitor = new LcpMonitor(
            () => { /* values read via gauge callback */ },
            deps.logger,
            deps.PerformanceObserver,
        );

        const unobserve = observe(
            deps.meter.createObservableGauge("lag_lcp_gauge", { unit : "ms" }),
            (result) => {
                const v = monitor.getLCP();
                if (v > 0) result.observe(v);
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
