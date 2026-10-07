import type { CoreDeps, FrameDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { FrameTimingMonitor, type FrameMeasurement } from "../FrameTimingMonitor.js";
import type { MeasurementConditions } from "../measurement-conditions.js";
import { METRICS, createCounter, createHistogram } from "../metric-catalog.js";
import { createHandle } from "./shared.js";

/**
 * Constructs a FrameTimingMonitor wired to `lag_frame_delta_histogram` and
 * the `lag_frames` counter (delivered and dropped frames).
 *
 * The fleet dropped-frame rate is `rate(lag_frames{outcome="dropped"})`
 * divided by the rate of all frames. With `conditions`, the monitor pauses
 * while the page is hidden (rAF does not run there), and a frame gap that
 * overlaps an unreliable interval is not recorded.
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
        const unpause = conditions?.pauseWhileHidden(monitor);

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
