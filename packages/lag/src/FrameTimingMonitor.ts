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
    /** The expected frame interval in ms that the estimate used. */
    targetFrameTimeMs : number;
};

/** The frame interval comes from the recent frames (see the class description). */
export const AUTO_FRAME_RATE = "auto";

/**
 * The window for the frame-interval estimate: about 10 seconds at 60 Hz.
 * Long enough that a burst of jank does not raise the estimate, short enough
 * to follow a change of the refresh rate.
 */
const ESTIMATE_WINDOW_FRAMES = 600;
/** Shorter deltas are timing noise (two callbacks in one frame), not a refresh rate. */
const MIN_PLAUSIBLE_FRAME_MS = 4;
/** The estimate before the first frames arrive. */
const INITIAL_FRAME_MS = 1000 / 60;

/**
 * Measures frame delivery rate via requestAnimationFrame.
 *
 * Dropped frames are estimated from the gap between consecutive callbacks:
 * `round(delta / frameInterval) - 1`. At 60 Hz a 50 ms gap counts as 2
 * dropped frames.
 *
 * By default (`targetFps = "auto"`), the frame interval is the shortest gap
 * of the last 600 frames. This follows the real refresh rate: 120 Hz
 * displays, and the 30 fps limit that power-saving modes apply. A fixed
 * `targetFps` uses `1000 / targetFps` instead.
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
    private readonly fixedFrameTimeMs : number | undefined;
    /** Recent deltas for the sliding-window minimum: a deque of [frame index, delta] with increasing deltas. */
    private readonly minimumDeque : Array<[number, number]> = [];
    private frameIndex = 0;

    constructor(
        private readonly report : (measurement : FrameMeasurement) => void,
        private readonly logger : Logger,
        private readonly requestAnimationFrameFn : RequestAnimationFrameFn,
        private readonly cancelAnimationFrameFn : CancelAnimationFrameFn,
        private readonly clock : Clock,
        targetFps : number | typeof AUTO_FRAME_RATE = AUTO_FRAME_RATE,
    ) {
        this.fixedFrameTimeMs = targetFps === AUTO_FRAME_RATE ? undefined : 1000 / targetFps;
        this.start();
    }

    /** The frame interval that the next drop estimate uses. */
    getFrameIntervalMs() : number {
        if (this.fixedFrameTimeMs !== undefined) return this.fixedFrameTimeMs;
        return this.minimumDeque[0]?.[1] ?? INITIAL_FRAME_MS;
    }

    private observeDelta(deltaMs : number) : void {
        if (deltaMs < MIN_PLAUSIBLE_FRAME_MS) return;
        const index = this.frameIndex++;
        while (this.minimumDeque.length > 0 && this.minimumDeque[this.minimumDeque.length - 1]![1] >= deltaMs) {
            this.minimumDeque.pop();
        }
        this.minimumDeque.push([index, deltaMs]);
        while (this.minimumDeque[0]![0] <= index - ESTIMATE_WINDOW_FRAMES) this.minimumDeque.shift();
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
                this.observeDelta(frameDeltaMs);
                const targetFrameTimeMs = this.getFrameIntervalMs();
                // Compute how many frame intervals this gap covers,
                // then subtract one for the frame that actually fired.
                const expectedSlots = Math.max(1, Math.round(frameDeltaMs / targetFrameTimeMs));
                const droppedFrames = expectedSlots - 1;

                this.observedFrames++;
                this.droppedTotal += droppedFrames;

                this.report({
                    frameDeltaMs,
                    fps : 1000 / frameDeltaMs,
                    droppedFrames,
                    isDropped : droppedFrames > 0,
                    targetFrameTimeMs,
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
