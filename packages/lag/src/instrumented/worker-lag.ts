import type { CoreDeps, PerformanceDeps, WorkerMonitorDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { WorkerLagMonitor } from "../WorkerLagMonitor.js";
import type { LifecycleStateMachine } from "../LifecycleStateMachine.js";
import { createHandle, createWindowGauges, pauseWhileHidden } from "./shared.js";

/**
 * One heartbeat per second: a main-thread block of length B is caught with
 * probability ~min(1, B / 1000ms), at the cost of one tiny message per second.
 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 1_000;

/**
 * Constructs a WorkerLagMonitor wired to two histograms + one max gauge.
 *
 * Metrics (all ms):
 * - `lag_worker_main_block_histogram` — how long each heartbeat waited for the
 *   main thread (main-thread blocking, measured from outside it)
 * - `lag_worker_self_lag_histogram` — the worker's own timer lateness
 *   (should be near zero; high values mean the worker itself was starved)
 * - `lag_worker_main_block_max_gauge` — worst wait since the last collection
 *
 * With a `lifecycle`, the monitor is paused while the page is hidden and
 * heartbeats that overlapped a hidden period are discarded (a frozen page
 * freezes its workers, then delivers a backlog on resume).
 */
export function createInstrumentedWorkerLag(
    deps : CoreDeps & WorkerMonitorDeps & PerformanceDeps,
    lifecycle? : LifecycleStateMachine,
) : MonitorHandle<WorkerLagMonitor> {
    return createHandle("worker-lag", deps.logger, () => {
        const mainBlockHist = deps.meter.createHistogram("lag_worker_main_block_histogram", { unit : "ms" });
        const selfLagHist = deps.meter.createHistogram("lag_worker_self_lag_histogram", { unit : "ms" });
        const gauges = createWindowGauges(deps.meter, { max : "lag_worker_main_block_max_gauge" }, "ms");
        const gate = lifecycle?.createHiddenGate();

        const monitor = new WorkerLagMonitor(
            deps.worker,
            (m) => {
                if (gate?.wasHiddenSinceLastCheck()) return;
                mainBlockHist.record(m.deliveryDelayMs);
                selfLagHist.record(m.workerSelfLagMs);
                gauges.record(m.deliveryDelayMs);
            },
            deps.logger,
            deps.performance,
            deps.workerHeartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
        );
        const unpause = lifecycle ? pauseWhileHidden(lifecycle, monitor, gate) : undefined;

        return {
            monitor,
            stop : () => {
                unpause?.();
                monitor.stop();
                gate?.dispose();
                gauges.dispose();
            },
        };
    });
}
