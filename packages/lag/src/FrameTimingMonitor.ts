import type { Clock, Logger } from "./types.js";

export type RequestAnimationFrameFn = (callback : (time : number) => void) => number;
export type CancelAnimationFrameFn = (handle : number) => void;

export type FrameMeasurement = {
    /** Wall-clock time since the previous frame. */
    frameDeltaMs : number;
    /** Instantaneous frame rate computed from this delta (1000 / frameDeltaMs). */
    fps : number;
    /**
     * Number of frames the engine *missed* between this callback and the
     * previous one. Computed as `max(0, round(delta / target) - 1)`.
     *
     * Examples (target = 16.67ms):
     *   delta = 16ms  → 0 dropped (one frame as expected)
     *   delta = 17ms  → 0 dropped (within tolerance, just slightly late)
     *   delta = 33ms  → 1 dropped (a full frame was skipped)
     *   delta = 50ms  → 2 dropped
     *   delta = 100ms → 5 dropped
     */
    droppedFrames : number;
    /** True iff `droppedFrames > 0`. */
    isDropped : boolean;
    /** Expected frame interval in ms (1000 / targetFps). */
    targetFrameTimeMs : number;
};

const DEFAULT_TARGET_FPS = 60;

/**
 * Measures frame delivery rate via requestAnimationFrame.
 *
 * Dropped frames are estimated from the gap between consecutive callbacks:
 * `round(delta / targetFrameTime) - 1`. At 60fps a 50ms gap counts as 2
 * dropped frames. The estimate assumes a fixed refresh rate (`targetFps`,
 * default 60): on a 120Hz display a single missed frame is too short to count.
 *
 * **Different from LongAnimationFrameMonitor:**
 * - LoAF measures *blocking* during frame production (script + render time)
 * - This measures *frame delivery* — the gap between successive rAF callbacks
 *
 * If LoAF says "no blocking" but FrameTimingMonitor sees dropped frames, the
 * issue is upstream (compositor, GPU, vsync misalignment). If both report
 * issues, the main thread is blocking frame production.
 */
export class FrameTimingMonitor {
    private handle : number | undefined;
    private lastFrameTime = -1;
    private started = false;
    private observedFrames = 0;
    private droppedTotal = 0;
    private readonly targetFrameTimeMs : number;

    constructor(
        private readonly report : (measurement : FrameMeasurement) => void,
        private readonly logger : Logger,
        private readonly requestAnimationFrameFn : RequestAnimationFrameFn,
        private readonly cancelAnimationFrameFn : CancelAnimationFrameFn,
        private readonly clock : Clock,
        targetFps : number = DEFAULT_TARGET_FPS,
    ) {
        this.targetFrameTimeMs = 1000 / targetFps;
        this.start();
    }

    start() : void {
        if (this.started) return;
        this.started = true;
        this.scheduleNextFrame();
    }

    stop() : void {
        this.started = false;
        if (this.handle !== undefined) {
            this.cancelAnimationFrameFn(this.handle);
            this.handle = undefined;
        }
        this.lastFrameTime = -1;
    }

    /**
     * Ratio of dropped frames to expected frames since startup or last reset.
     *
     * Computed as `droppedTotal / (observedFrames + droppedTotal)`. This is
     * the fraction of *intended* frames the engine failed to deliver — a
     * 50% rate means half of the expected frames were skipped.
     */
    getDroppedFrameRate() : number {
        const expected = this.observedFrames + this.droppedTotal;
        if (expected === 0) return 0;
        return this.droppedTotal / expected;
    }

    /** Total dropped frames since startup or last reset. */
    getDroppedTotal() : number {
        return this.droppedTotal;
    }

    /** Total observed frames since startup or last reset. */
    getObservedTotal() : number {
        return this.observedFrames;
    }

    resetCounters() : void {
        this.observedFrames = 0;
        this.droppedTotal = 0;
    }

    private scheduleNextFrame() : void {
        if (!this.started) return;
        const handle : number = this.requestAnimationFrameFn(() => this.onFrame(handle));
        this.handle = handle;
    }

    /** `handle` identifies this callback's chain; report() may stop or restart the monitor. */
    private onFrame(handle : number) : void {
        if (!this.started || this.handle !== handle) return;

        try {
            const now = this.clock.now();
            const lastFrameTime = this.lastFrameTime;
            // Before report(), so a stop() inside it can reset the baseline
            this.lastFrameTime = now;

            if (lastFrameTime >= 0) {
                const frameDeltaMs = now - lastFrameTime;
                // Compute how many target-frame intervals this gap covers,
                // then subtract one for the frame that actually fired.
                const expectedSlots = Math.max(1, Math.round(frameDeltaMs / this.targetFrameTimeMs));
                const droppedFrames = expectedSlots - 1;

                this.observedFrames++;
                this.droppedTotal += droppedFrames;

                this.report({
                    frameDeltaMs,
                    fps : 1000 / frameDeltaMs,
                    droppedFrames,
                    isDropped : droppedFrames > 0,
                    targetFrameTimeMs : this.targetFrameTimeMs,
                });
            }
        } catch (error) {
            this.logger.log("error", "Error in frame timing measurement.", {
                error,
                type : "FrameTimingMonitor",
            });
        }

        if (this.handle === handle) this.scheduleNextFrame();
    }
}
