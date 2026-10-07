import type { CoreDeps, EventDeps, PerformanceDeps, TimerDeps, WorkerMonitorDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { WorkerLagMonitor } from "../WorkerLagMonitor.js";
import type { MeasurementConditions } from "../measurement-conditions.js";
import { EVENTS, METRICS, createCounter, createHistogram } from "../metric-catalog.js";
import { createHandle, validatedRecorder } from "./shared.js";

/**
 * One heartbeat each second: a main-thread block of length B is seen with a
 * probability of about min(1, B / 1000 ms), for one small message each second.
 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 1_000;
const DEFAULT_HANG_THRESHOLD_MS = 5_000;

/**
 * Constructs a WorkerLagMonitor wired to:
 * - `lag_worker_main_block_histogram`: how long each heartbeat waited for
 *   the main thread (main-thread blocking, measured from outside it)
 * - `lag_worker_self_lag_histogram`: the worker's own timer lateness
 * - `lag_worker_clock_offset_histogram`: the result of each clock
 *   synchronization
 * - `lag_main_thread_hangs` and `lag_main_thread_hang_duration_histogram`:
 *   hangs that the worker detected
 *
 * A heartbeat for which the worker itself was late by 5 s or more is
 * evidence of a system suspend. With `conditions`, the factory adds it to the
 * reliability tracker, so the main-thread monitors discard samples that
 * overlap it. With `conditions`, the monitor also pauses while the page is
 * hidden.
 */
export function createInstrumentedWorkerLag(
    deps : CoreDeps & WorkerMonitorDeps & PerformanceDeps & Pick<TimerDeps, "setTimeoutFn" | "clearTimeoutFn"> & Partial<EventDeps>,
    conditions? : MeasurementConditions,
) : MonitorHandle<WorkerLagMonitor> {
    return createHandle("worker-lag", deps.logger, () => {
        const mainBlockHist = createHistogram(deps.meter, METRICS.workerMainBlock);
        const selfLagHist = createHistogram(deps.meter, METRICS.workerSelfLag);
        const offsetHist = createHistogram(deps.meter, METRICS.workerClockOffset);
        const hangs = createCounter(deps.meter, METRICS.hangs);
        const hangDurationHist = createHistogram(deps.meter, METRICS.hangDuration);
        const recorder = validatedRecorder(conditions, (delay) => mainBlockHist.record(delay));

        const monitor = new WorkerLagMonitor(
            deps.worker,
            (m) => {
                selfLagHist.record(m.workerSelfLagMs);
                recorder.submit(m.deliveryDelayMs, m.deliveryDelayMs);
            },
            deps.logger,
            deps.performance,
            {
                heartbeatIntervalMs : deps.workerHeartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS,
                setTimeoutFn : deps.setTimeoutFn,
                clearTimeoutFn : deps.clearTimeoutFn,
                hang : {
                    thresholdMs : DEFAULT_HANG_THRESHOLD_MS,
                    ...(deps.workerHangReport ? { report : deps.workerHangReport } : {}),
                },
                events : {
                    onSystemStall : (stall) => conditions?.tracker.add(stall.start, stall.end, "suspend"),
                    onHangEnded : (durationMs) => {
                        hangs.add(1);
                        hangDurationHist.record(durationMs);
                        deps.events?.emit(EVENTS.hang.name, { phase : "ended", duration_ms : durationMs });
                    },
                    onClockSync : ({ offsetMs }) => offsetHist.record(Math.abs(offsetMs)),
                },
            },
        );
        const unpause = conditions?.pauseWhileHidden(monitor);

        return {
            monitor,
            stop : () => {
                unpause?.();
                monitor.stop();
                recorder.dispose();
            },
        };
    });
}
