import type { CoreDeps, TimerDeps, WorkerMonitorDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import {
    WorkerLagMonitor,
    type WorkerLagMeasurement,
} from "../WorkerLagMonitor.js";

const DEFAULT_PING_INTERVAL_MS = 5_000;

/**
 * Constructs a WorkerLagMonitor wired to three histograms + one max gauge.
 *
 * Metrics (all ms):
 * - `lag_worker_roundtrip_histogram` — ping→pong round-trip
 * - `lag_worker_main_block_histogram` — estimated main-thread block
 *   (roundTrip - workerSelfLag)
 * - `lag_worker_self_lag_histogram` — worker's own timing-loop lag
 *   (should be near-zero in a healthy worker)
 * - `lag_worker_roundtrip_max_gauge` — worst round-trip since last collection
 */
export function createInstrumentedWorkerLag(
    deps : CoreDeps & WorkerMonitorDeps & Pick<TimerDeps, "setIntervalFn" | "clearIntervalFn">,
) : MonitorHandle<WorkerLagMonitor> {
    try {
        const roundtripHist = deps.meter.createHistogram<WorkerLagMeasurement>(
            "lag_worker_roundtrip_histogram", { unit : "ms" });
        const mainBlockHist = deps.meter.createHistogram<WorkerLagMeasurement>(
            "lag_worker_main_block_histogram", { unit : "ms" });
        const selfLagHist = deps.meter.createHistogram<WorkerLagMeasurement>(
            "lag_worker_self_lag_histogram", { unit : "ms" });
        const maxGauge = deps.meter.createObservableGauge<Record<string, never>>(
            "lag_worker_roundtrip_max_gauge", { unit : "ms" });

        let maxRoundtrip = 0;

        const monitor = new WorkerLagMonitor(
            deps.worker,
            (m) => {
                roundtripHist.record(m.roundTripMs, m);
                mainBlockHist.record(m.estimatedMainBlockMs, m);
                selfLagHist.record(m.workerSelfLagMs, m);
                if (m.roundTripMs > maxRoundtrip) maxRoundtrip = m.roundTripMs;
            },
            deps.logger,
            deps.setIntervalFn,
            deps.clearIntervalFn,
            deps.clock,
            deps.workerPingIntervalMs ?? DEFAULT_PING_INTERVAL_MS,
        );

        maxGauge.addCallback((result) => {
            if (maxRoundtrip > 0) {
                result.observe(maxRoundtrip);
                maxRoundtrip = 0;
            }
        });

        return { name : "worker-lag", monitor, stop : () => monitor.stop() };
    } catch (error) {
        deps.logger.log("warn", "Failed to create WorkerLagMonitor.", {
            error,
            type : "createInstrumentedWorkerLag",
        });
        return { name : "worker-lag", monitor : undefined, stop : () => {} };
    }
}
