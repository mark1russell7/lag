import type { AbsoluteClockDeps, CoreDeps, EventDeps, PerformanceDeps, TimerDeps, WallClockDeps, WorkerMonitorDeps } from "../dep-groups.js";
import { createAbsoluteClock } from "../absolute-clock.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { WorkerLagMonitor } from "../WorkerLagMonitor.js";
import type { MeasurementConditions } from "../measurement-conditions.js";
import { EVENTS, METRICS, createCounter, createHistogram } from "../metric-catalog.js";
import { createHandle, validatedRecorder } from "./shared.js";
import { findAbandonedHangs, HANG_JOURNAL_STALE_MS } from "../hang-journal.js";
import { createRandomId } from "../random-id.js";

/**
 * One heartbeat each second. The monitor sees a main-thread block of length
 * B with a probability of approximately min(1, B / 1000 ms). The cost is one
 * small message each second.
 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 1_000;
const DEFAULT_HANG_THRESHOLD_MS = 5_000;

/**
 * This factory makes a `WorkerLagMonitor` that records into:
 * - `lag_worker_main_block_histogram`: how long each heartbeat waited for
 *   the main thread (main-thread blocking, measured from outside it)
 * - `lag_worker_self_lag_histogram`: the lateness of the timer of the worker
 * - `lag_worker_clock_offset_histogram`: the absolute offset of each clock
 *   synchronization
 * - `lag_main_thread_hangs` and `lag_main_thread_hang_duration_histogram`:
 *   the hangs that the worker detected
 *
 * A heartbeat for which the worker itself was late by 5 s or more is
 * evidence of a system suspend. With `conditions`, the factory adds it to the
 * reliability tracker, so the main-thread monitors discard samples that
 * overlap it. With `conditions`, the monitor also pauses while the page is
 * hidden.
 *
 * With `deps.hangJournal`, the factory reads the journal one time at the
 * start. It reports each hang that an earlier page did not survive as a hang
 * with the outcome `abandoned`, and removes its record. Other pages of the
 * origin can read the journal at the same time: the record goes to only one
 * page (`HangJournal.take`).
 *
 * The peer hang watch can report a hang before the journal reader does. With
 * `deps.hangReportMarks`, the factory removes the record of a marked hang,
 * but it does not count the hang again. It also removes the old marks of
 * pages that have no record.
 */
export function createInstrumentedWorkerLag(
    deps : CoreDeps & WorkerMonitorDeps & PerformanceDeps & Partial<AbsoluteClockDeps> & Partial<WallClockDeps> & Pick<TimerDeps, "setTimeoutFn" | "clearTimeoutFn"> & Partial<EventDeps>,
    conditions? : MeasurementConditions,
) : MonitorHandle<WorkerLagMonitor> {
    return createHandle("worker-lag", deps.logger, () => {
        const mainBlockHist = createHistogram(deps.meter, METRICS.workerMainBlock);
        const selfLagHist = createHistogram(deps.meter, METRICS.workerSelfLag);
        const offsetHist = createHistogram(deps.meter, METRICS.workerClockOffset);
        const hangs = createCounter<{ outcome : "ended" | "abandoned" }>(deps.meter, METRICS.hangs);
        const hangDurationHist = createHistogram<{ outcome : "ended" | "abandoned" }>(deps.meter, METRICS.hangDuration);
        const pageId = deps.pageId ?? createRandomId();
        const clock = deps.absoluteClock ?? createAbsoluteClock(deps.performance);
        const recorder = validatedRecorder(conditions, (delay) => mainBlockHist.record(delay));

        const monitor = new WorkerLagMonitor(
            deps.worker,
            (m) => {
                selfLagHist.record(m.workerSelfLagMs);
                recorder.submit(m.deliveryDelayMs, m.deliveryDelayMs);
            },
            deps.logger,
            clock,
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
                    onHangEnded : (durationMs, startedAt) => {
                        hangs.add(1, { outcome : "ended" });
                        hangDurationHist.record(durationMs, { outcome : "ended" });
                        // The absolute times of the worker and of the page share the Unix epoch
                        deps.events?.emit(EVENTS.hang.name, { phase : "ended", duration_ms : durationMs }, { time : startedAt });
                    },
                    onClockSync : ({ offsetMs }) => offsetHist.record(Math.abs(offsetMs)),
                },
                // Without a journal on this side, the worker writes none either
                ...(deps.hangJournal ? { pageId } : {}),
            },
        );

        // Hangs that earlier pages of the origin did not survive
        const journal = deps.hangJournal;
        const marks = deps.hangReportMarks;
        let stopped = false;
        if (journal) {
            journal.list().then(async (records) => {
                const wallNow = deps.wallClock?.now() ?? Date.now();
                for (const candidate of findAbandonedHangs(records, wallNow, pageId)) {
                    if (stopped) return;
                    const record = await journal.take(candidate.pageId, wallNow - HANG_JOURNAL_STALE_MS);
                    if (!record) continue;
                    if (stopped) {
                        // Keep the record for the next page
                        await journal.put(record);
                        return;
                    }
                    // The peer hang watch reported this hang already. The record is gone now.
                    if (marks?.take(record.pageId)) continue;
                    const durationMs = record.lastSeenAt - record.startedAt;
                    hangs.add(1, { outcome : "abandoned" });
                    hangDurationHist.record(durationMs, { outcome : "abandoned" });
                    deps.events?.emit(EVENTS.hang.name, {
                        ...record.attributes,
                        phase : "abandoned",
                        duration_ms : durationMs,
                        "lag.hang.page_id" : record.pageId,
                        "lag.hang.source" : "journal",
                    }, { time : record.startedAt });
                }
                // A mark is necessary only while the journal can have a record of its page
                marks?.prune(wallNow - HANG_JOURNAL_STALE_MS, new Set(records.map(record => record.pageId)));
            }).catch((error : unknown) => {
                deps.logger.log("warn", "Could not read the hang journal.", { error, type : "WorkerLagMonitor" });
            });
        }
        const unpause = conditions?.pauseWhileHidden(monitor);

        return {
            monitor,
            stop : () => {
                stopped = true;
                unpause?.();
                monitor.dispose();
                recorder.dispose();
            },
        };
    });
}
