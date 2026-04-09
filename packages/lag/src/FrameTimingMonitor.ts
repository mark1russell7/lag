import type { Clock, Logger } from "./types.js";

export type RequestAnimationFrameFn = (callback : (time : number) => void) => number;
export type CancelAnimationFrameFn = (handle : number) => void;

export type FrameMeasurement = {
    frameDeltaMs : number;       // time since previous frame
    fps : number;                // instantaneous fps (1000 / frameDeltaMs)
    isDropped : boolean;         // true if frameDelta > 2x target frame time
    targetFrameTimeMs : number;  // expected frame interval (default ~16.67ms for 60fps)
};

const DEFAULT_TARGET_FPS = 60;
const DROPPED_FRAME_THRESHOLD = 2.0; // frame is "dropped" if delta > 2x target

/**
 * Measures frame delivery rate via requestAnimationFrame.
 *
 * Different from LongAnimationFrameMonitor:
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
    private frameCount = 0;
    private droppedCount = 0;
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

    getDroppedFrameRate() : number {
        if (this.frameCount === 0) return 0;
        return this.droppedCount / this.frameCount;
    }

    resetCounters() : void {
        this.frameCount = 0;
        this.droppedCount = 0;
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
                const isDropped = frameDeltaMs > this.targetFrameTimeMs * DROPPED_FRAME_THRESHOLD;

                this.frameCount++;
                if (isDropped) this.droppedCount++;

                this.report({
                    frameDeltaMs,
                    fps : 1000 / frameDeltaMs,
                    isDropped,
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
