import type { CoreDeps, SchedulingDeps, TimerDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { DriftLag, type UnreadStepMode } from "../DriftLag.js";
import type { LagValueSource } from "../LagMonitor.js";
import { createMessageTaskQueue } from "../message-task.js";
import { LagLogger } from "../LagLogger.js";
import type { MeasurementConditions } from "../measurement-conditions.js";
import { highFrequencyLagIntervalMs } from "../constants.js";
import { METRICS, createCounter, createHistogram } from "../metric-catalog.js";
import { createHandle, validatedRecorder } from "./shared.js";

/**
 * This factory makes a `DriftLag` monitor that records into
 * `lag_drift_histogram`, into `lag_drift_baseline_histogram` (the calibrated
 * idle step) and into `LagLogger`. `LagLogger` logs sustained lag in periods
 * of 2 s and 5 s.
 *
 * This monitor gives the primary high-frequency lag signal (one sample for
 * each window of approximately 100 ms). With `conditions`, the monitor
 * pauses while the page is hidden, and while its frame is off the screen
 * (the `viewport` of the conditions). Also, it does not record a sample whose
 * window overlaps an unreliable interval, and it records the baseline only
 * with a valid sample. With `deps.MessageChannel`, a probe of message tasks
 * confirms each larger increase of the baseline. Thus, a sustained load
 * does not increase the baseline. The probe also finds throttled timers on a
 * visible page, and the monitor gives that state to `conditions`
 * (`setTimersThrottled`).
 *
 * With `options.recordThrottledSteps`, a long step of throttled timers can give
 * a value. The attribute `source` of `lag_drift_histogram` and the log mark it.
 * The window of that value holds the long step. Thus the conditions discard it
 * when the long step overlaps an unreliable interval.
 */
export function createInstrumentedDriftLag(
    deps : CoreDeps & TimerDeps & Partial<Pick<SchedulingDeps, "MessageChannel">>,
    conditions? : MeasurementConditions,
    options? : { readonly recordThrottledSteps? : boolean },
) : MonitorHandle<DriftLag> {
    return createHandle("drift-lag", deps.logger, () => {
        const histogram = createHistogram(deps.meter, METRICS.drift);
        const baselineHistogram = createHistogram(deps.meter, METRICS.driftBaseline);
        const unreadSteps = createCounter<{ mode : UnreadStepMode }>(deps.meter, METRICS.driftUnreadSteps);
        const lagLogger = new LagLogger(highFrequencyLagIntervalMs, deps.logger);
        const tasks = deps.MessageChannel ? createMessageTaskQueue(deps.MessageChannel) : undefined;
        const record = (source : LagValueSource | undefined) => (lag : number, windowMs : number) : void => {
            if (source === undefined) histogram.record(lag);
            else histogram.record(lag, { source });
            baselineHistogram.record(monitor.getBaselineMs());
            lagLogger.addMeasurement({ value : lag, attributes : source === undefined ? { wasHidden : false } : { wasHidden : false, source }, intervalMs : windowMs - lag });
        };
        // A sample can wait for evidence, so each mark has its own recorder
        const recorder = validatedRecorder(conditions, record(undefined));
        const throttledRecorder = validatedRecorder(conditions, record("throttled-step"));

        const monitor : DriftLag = new DriftLag(
            highFrequencyLagIntervalMs,
            (value : number, source? : LagValueSource) => {
                // A negative value is jitter around the baseline
                (source === undefined ? recorder : throttledRecorder).submit(Math.max(0, value), monitor.getLastWindowMs());
            },
            deps.logger,
            deps.setIntervalFn,
            deps.clearIntervalFn,
            deps.setTimeoutFn,
            deps.clearTimeoutFn,
            deps.clock,
            tasks ? {
                postTask : (callback) => tasks.post(callback),
                // The monitors of the rendering pause while the timers of the visible page are throttled
                ...(conditions ? { onThrottle : (throttled : boolean) => conditions.setTimersThrottled(throttled) } : {}),
                ...(options?.recordThrottledSteps ? { recordThrottledSteps : true } : {}),
                onUnreadStep : (mode : UnreadStepMode) => unreadSteps.add(1, { mode }),
            } : {},
        );
        // In a frame off the screen, WebKit makes the nested timers of the chain wait approximately 1 s (experiment E9)
        const unpause = conditions?.pauseWhileHidden(monitor, { offscreen : true });

        return {
            monitor,
            stop : () => {
                unpause?.();
                monitor.stop();
                tasks?.close();
                recorder.dispose();
                throttledRecorder.dispose();
            },
        };
    });
}
