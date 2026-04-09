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
 * **Drop detection is exact, not heuristic.** We compute how many frames
 * *should* have fit in the observed gap and subtract one (the frame that
 * actually fired). For target = 16.67ms:
 *
 *   round(50 / 16.67) - 1 = round(3) - 1 = 2 dropped
 *
 * `Math.round` (rather than `Math.floor`) is used so that a delta of 16.7ms
 * counts as one frame (not zero), and a delta of 25ms counts as one frame
 * (not zero). This matches how Chrome's frame timing reports work.
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
        this.handle = this.requestAnimationFrameFn(() => this.onFrame());
    }

    private onFrame() : void {
        if (!this.started) return;

        try {
            const now = this.clock.now();

            if (this.lastFrameTime >= 0) {
                const frameDeltaMs = now - this.lastFrameTime;
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

            this.lastFrameTime = now;
        } catch (error) {
            this.logger.log("error", "Error in frame timing measurement.", {
                error,
                type : "FrameTimingMonitor",
            });
        }

        this.scheduleNextFrame();
    }
}
