import type { CoreDeps, FrameDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { FrameTimingMonitor } from "../FrameTimingMonitor.js";
import type { LifecycleStateMachine } from "../LifecycleStateMachine.js";
import { createHandle, observe, pauseWhileHidden } from "./shared.js";

/**
 * Constructs a FrameTimingMonitor wired to one histogram + two gauges.
 *
 * Metrics:
 * - `lag_frame_delta_histogram` — time between consecutive rAF callbacks
 * - `lag_frame_fps_gauge` — frames delivered per second since the last collection
 * - `lag_frame_dropped_rate_gauge` — dropped / expected frames since the last collection
 *
 * With a `lifecycle`, the monitor is paused while the page is hidden. rAF
 * doesn't run there, so otherwise the first frame after returning would
 * report the whole hidden period as one giant frame.
 */
export function createInstrumentedFrameTiming(
    deps : CoreDeps & FrameDeps,
    lifecycle? : LifecycleStateMachine,
) : MonitorHandle<FrameTimingMonitor> {
    return createHandle("frame-timing", deps.logger, () => {
        const deltaHist = deps.meter.createHistogram("lag_frame_delta_histogram", { unit : "ms" });

        // Each gauge resets its own window when collected
        const fpsWindow = { frames : 0, elapsedMs : 0 };
        const dropWindow = { delivered : 0, dropped : 0 };

        const monitor = new FrameTimingMonitor(
            (m) => {
                deltaHist.record(m.frameDeltaMs);
                fpsWindow.frames++;
                fpsWindow.elapsedMs += m.frameDeltaMs;
                dropWindow.delivered++;
                dropWindow.dropped += m.droppedFrames;
            },
            deps.logger,
            deps.requestAnimationFrame,
            deps.cancelAnimationFrame,
            deps.clock,
        );
        const unpause = lifecycle ? pauseWhileHidden(lifecycle, monitor) : undefined;

        const disposers = [
            observe(
                deps.meter.createObservableGauge("lag_frame_fps_gauge", { unit : "fps" }),
                (result) => {
                    if (fpsWindow.elapsedMs > 0) result.observe((fpsWindow.frames * 1000) / fpsWindow.elapsedMs);
                    fpsWindow.frames = 0;
                    fpsWindow.elapsedMs = 0;
                },
            ),
            observe(
                deps.meter.createObservableGauge("lag_frame_dropped_rate_gauge", { unit : "ratio" }),
                (result) => {
                    const expected = dropWindow.delivered + dropWindow.dropped;
                    if (expected > 0) result.observe(dropWindow.dropped / expected);
                    dropWindow.delivered = 0;
                    dropWindow.dropped = 0;
                },
            ),
        ];

        return {
            monitor,
            stop : () => {
                unpause?.();
                for (const dispose of disposers) dispose();
                monitor.stop();
            },
        };
    });
}
