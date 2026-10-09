import type { CoreDeps, EventDeps, PeerDeps, SpanDeps, TimerDeps, WallClockDeps, WorkerMonitorDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { isVisibleState, type LifecycleStateMachine } from "../LifecycleStateMachine.js";
import { PeerHangWatch } from "../PeerHangWatch.js";
import { EVENTS, METRICS, createCounter, createHistogram } from "../metric-catalog.js";
import { createHandle, recordHangSpan } from "./shared.js";
import { createRandomId } from "../random-id.js";

/**
 * This factory makes a `PeerHangWatch`: the open pages of the origin watch
 * each other for hangs. When another page closes during a hang, this page
 * records it into the metrics of the worker monitor:
 * `lag_main_thread_hangs` and `lag_main_thread_hang_duration_histogram`,
 * with the outcome `abandoned`. It also emits a `lag.main_thread.hang` event
 * with the phase `abandoned`, the context of the hung page, and
 * `lag.hang.source: "peer"`. When this page itself closes at the end of a
 * hang, it reports that hang with `lag.hang.source: "self"`.
 *
 * The watch does not need a worker. In WebKit and Safari, it is the only
 * way to keep a hang that the page does not survive (experiment E7). In the
 * other engines, it takes the record of the worker of the hung page from
 * the hang journal. Thus the next page does not report the hang again. With
 * `deps.hangReportMarks`, the watch marks each hang that it reports without
 * the record, for example its own hang. The journal reader of the worker
 * monitor does not count a marked hang again.
 *
 * The page sends heartbeats and holds its lock only while it is visible
 * (the states `active` and `passive` of `lifecycle`). A hidden page watches
 * the others. A frozen page and a page in the back/forward cache close their
 * channel. Thus the messages of other pages do not remove them from the
 * cache.
 */
export function createInstrumentedPeerHangWatch(
    deps : CoreDeps & PeerDeps & WallClockDeps & TimerDeps & Partial<EventDeps> & Partial<SpanDeps> & Pick<WorkerMonitorDeps, "hangJournal" | "hangReportMarks" | "pageId">,
    lifecycle : LifecycleStateMachine,
) : MonitorHandle<PeerHangWatch> {
    return createHandle("peer-hang-watch", deps.logger, () => {
        const hangs = createCounter<{ outcome : "ended" | "abandoned" }>(deps.meter, METRICS.hangs);
        const hangDurationHist = createHistogram<{ outcome : "ended" | "abandoned" }>(deps.meter, METRICS.hangDuration);

        const watch = new PeerHangWatch(deps, {
            pageId : deps.pageId ?? createRandomId(),
            visible : isVisibleState(lifecycle.getState()),
            ...(deps.hangJournal ? { journal : deps.hangJournal } : {}),
            ...(deps.hangReportMarks ? { marks : deps.hangReportMarks } : {}),
            onAbandonedHang : (record, source) => {
                const durationMs = Math.max(0, record.lastSeenAt - record.startedAt);
                hangs.add(1, { outcome : "abandoned" });
                hangDurationHist.record(durationMs, { outcome : "abandoned" });
                deps.events?.emit(EVENTS.hang.name, {
                    ...record.attributes,
                    phase : "abandoned",
                    duration_ms : durationMs,
                    "lag.hang.page_id" : record.pageId,
                    "lag.hang.source" : source,
                }, { time : record.startedAt });
                // In the trace of the page that hung: its beats and its record have the identity of its page view
                recordHangSpan(deps, {
                    startedAt : record.startedAt,
                    durationMs,
                    attributes : { phase : "abandoned", duration_ms : durationMs, "lag.hang.page_id" : record.pageId, "lag.hang.source" : source },
                    hungPage : record.attributes,
                });
            },
        });
        // A page in the back/forward cache or a frozen page closes its channel: Chrome removes a page from
        // the cache when a message arrives for it. A page that closes (pagehide without the back/forward
        // cache) reports its own hang, if it closes at the end of one.
        const unsubscribe = lifecycle.subscribe(({ to }) => {
            if (to === "frozen") {
                watch.suspend();
                return;
            }
            watch.resume();
            if (isVisibleState(to)) watch.show();
            else watch.hide(to === "terminated");
        });

        return {
            monitor : watch,
            stop : () => {
                unsubscribe();
                watch.stop();
            },
        };
    });
}
