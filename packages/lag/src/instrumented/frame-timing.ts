import type { CoreDeps, FrameDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { FrameTimingMonitor, type FrameMeasurement } from "../FrameTimingMonitor.js";

/**
 * Constructs a FrameTimingMonitor wired to one histogram + two gauges.
 *
 * Metrics:
 * - `lag_frame_delta_histogram` — time between consecutive rAF callbacks
 * - `lag_frame_fps_gauge` — instantaneous FPS from the last frame
 * - `lag_frame_dropped_rate_gauge` — cumulative dropped/observed ratio
 *
 * Dropped frame detection is exact: `round(delta / targetFrameTime) - 1`.
 */
export function createInstrumentedFrameTiming(
    deps : CoreDeps & FrameDeps,
) : MonitorHandle<FrameTimingMonitor> {
    try {
        const deltaHist = deps.meter.createHistogram<FrameMeasurement>(
            "lag_frame_delta_histogram", { unit : "ms" });
        const fpsGauge = deps.meter.createObservableGauge<Record<string, never>>(
            "lag_frame_fps_gauge", { unit : "fps" });
        const droppedGauge = deps.meter.createObservableGauge<Record<string, never>>(
            "lag_frame_dropped_rate_gauge", { unit : "ratio" });

        let lastFps = 0;

        const monitor = new FrameTimingMonitor(
            (m) => {
                deltaHist.record(m.frameDeltaMs, m);
                lastFps = m.fps;
            },
            deps.logger,
            deps.requestAnimationFrame,
            deps.cancelAnimationFrame,
            deps.clock,
        );

        fpsGauge.addCallback((result) => {
            if (lastFps > 0) result.observe(lastFps);
        });
        droppedGauge.addCallback((result) => {
            result.observe(monitor.getDroppedFrameRate());
        });

        return { name : "frame-timing", monitor, stop : () => monitor.stop() };
    } catch (error) {
        deps.logger.log("warn", "Failed to create FrameTimingMonitor.", {
            error,
            type : "createInstrumentedFrameTiming",
        });
        return { name : "frame-timing", monitor : undefined, stop : () => {} };
    }
}
