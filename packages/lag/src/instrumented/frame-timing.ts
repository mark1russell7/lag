import type { CoreDeps, FrameDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { FrameTimingMonitor, type FrameMeasurement } from "../FrameTimingMonitor.js";
import type { MeasurementConditions } from "../measurement-conditions.js";
import { METRICS, createCounter, createHistogram } from "../metric-catalog.js";
import { createHandle } from "./shared.js";

/**
 * This factory makes a `FrameTimingMonitor` that records into
 * `lag_frame_delta_histogram` and into the `lag_frames` counter (delivered
 * and dropped frames).
 *
 * The dropped-frame rate of the fleet is
 * `rate(lag_frames{outcome="dropped"})` divided by the rate of all frames.
 * With `conditions`, the monitor pauses while the page is hidden, because
 * `requestAnimationFrame` does not operate in a hidden page. It also pauses
 * while its frame is off-screen (the `viewport` of the conditions), and while
 * the timers of the visible page are throttled (the signal of DriftLag). Also, the
 * monitor does not record a frame gap that overlaps an unreliable interval.
 */
export function createInstrumentedFrameTiming(
    deps : CoreDeps & FrameDeps,
    conditions? : MeasurementConditions,
) : MonitorHandle<FrameTimingMonitor> {
    return createHandle("frame-timing", deps.logger, () => {
        const deltaHist = createHistogram(deps.meter, METRICS.frameDelta);
        const frames = createCounter<{ outcome : "delivered" | "dropped" }>(deps.meter, METRICS.frames);
        const validator = conditions?.createValidator();

        const record = (m : FrameMeasurement) : void => {
            deltaHist.record(m.frameDeltaMs);
            frames.add(1, { outcome : "delivered" });
            if (m.droppedFrames > 0) frames.add(m.droppedFrames, { outcome : "dropped" });
        };

        const monitor = new FrameTimingMonitor(
            (m) => {
                if (validator) validator.submit(m.frameDeltaMs, m.frameDeltaMs, () => record(m));
                else record(m);
            },
            deps.logger,
            deps.requestAnimationFrame,
            deps.cancelAnimationFrame,
            deps.clock,
        );
        // A frame off-screen gets no animation frames in Chromium and WebKit, and one each second in Firefox.
        // Safari halves the frame rate of a page that it does not show, and DriftLag finds its throttled timers.
        const unpause = conditions?.pauseWhileHidden(monitor, { offscreen : true, throttled : true });

        return {
            monitor,
            stop : () => {
                unpause?.();
                monitor.stop();
                validator?.dispose();
            },
        };
    });
}
