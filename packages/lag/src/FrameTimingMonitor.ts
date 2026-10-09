import type { Clock, Logger } from "./types.js";

export type RequestAnimationFrameFn = (callback : (time : number) => void) => number;
export type CancelAnimationFrameFn = (handle : number) => void;

export type FrameMeasurement = {
    /**
     * The time since the previous frame: the difference between the frame
     * timestamps that `requestAnimationFrame` gives to the two callbacks.
     */
    frameDeltaMs : number;
    /** The instantaneous frame rate from this delta: `1000 / frameDeltaMs`. */
    fps : number;
    /**
     * The number of frames that the engine *missed* between this callback
     * and the previous one: `max(0, round(delta / target) - 1)`.
     *
     * Examples, with a target of 16.67 ms:
     *
     * - A delta of 16 ms gives 0 dropped frames. One frame came, as expected.
     * - A delta of 17 ms gives 0 dropped frames. The frame is a little late,
     *   but in the tolerance.
     * - A delta of 33 ms gives 1 dropped frame. The engine skipped a full
     *   frame.
     * - A delta of 50 ms gives 2 dropped frames.
     * - A delta of 100 ms gives 5 dropped frames.
     */
    droppedFrames : number;
    /** True if `droppedFrames > 0`. */
    isDropped : boolean;
    /** The expected frame interval, in ms, that the estimate used. */
    targetFrameTimeMs : number;
};

/** The frame interval comes from the recent frames (refer to the class description). */
export const AUTO_FRAME_RATE = "auto";

/**
 * The window for the estimate of the frame interval: approximately 10
 * seconds at 60 Hz. The window is long enough that a burst of jank does not
 * increase the estimate. It is short enough to follow a change of the
 * refresh rate.
 */
const ESTIMATE_WINDOW_FRAMES = 600;
/**
 * The estimate is the delta at this position in the sorted window (1 is the
 * shortest). Thus, fewer short deltas than this value do not lower the
 * estimate. An example of a short delta is an on-time frame after a late
 * frame. With an interval below the refresh interval, each normal frame
 * counts as a dropped frame.
 */
const ESTIMATE_RANK = 5;
/** A shorter delta is timing noise (two callbacks in one frame), not a refresh rate. */
const MIN_PLAUSIBLE_FRAME_MS = 4;
/** The estimate until the window has `ESTIMATE_RANK` deltas. */
const INITIAL_FRAME_MS = 1000 / 60;

/**
 * This monitor measures the frame delivery rate through
 * `requestAnimationFrame`.
 *
 * The monitor estimates the dropped frames from the gap between two
 * consecutive callbacks: `round(delta / frameInterval) - 1`. At 60 Hz, a
 * gap of 50 ms counts as 2 dropped frames.
 *
 * The gaps come from the frame timestamps, which `requestAnimationFrame`
 * gives to the callbacks. Thus, a callback that starts late in its frame
 * does not change the gap. Without a timestamp, the monitor reads `clock`.
 *
 * By default (`targetFps = "auto"`), the frame interval is the fifth-shortest
 * gap of the last 600 frames. Until 5 gaps are available, the interval is
 * 16.67 ms (60 Hz). The estimate ignores gaps of less than 4 ms. Thus, the
 * interval follows the real refresh rate, for example of a 120 Hz screen,
 * or the 30 fps limit of a power-saving mode. One short gap does not lower
 * the interval. A fixed `targetFps` uses `1000 / targetFps`.
 *
 * **The difference from `LongAnimationFrameMonitor`:**
 * - LoAF measures the *blocking* during the production of a frame (script
 *   and render time).
 * - This monitor measures the *frame delivery*: the gap between two
 *   consecutive `requestAnimationFrame` callbacks.
 *
 * If LoAF shows no blocking but this monitor sees dropped frames, the
 * problem is upstream. For example, the problem is in the compositor, the
 * GPU or the vsync alignment. If both monitors report problems, the main
 * thread blocks the production of frames.
 */
export class FrameTimingMonitor {
    private handle : number | undefined;
    private lastFrameTime = -1;
    private started = false;
    private observedFrames = 0;
    private droppedTotal = 0;
    private readonly fixedFrameTimeMs : number | undefined;
    /** The deltas of the window in a ring, in the sequence of the frames. */
    private readonly recentDeltas : number[] = [];
    /** The same deltas, sorted from the shortest to the longest. */
    private readonly sortedDeltas : number[] = [];
    private deltaCount = 0;

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
        return this.sortedDeltas[ESTIMATE_RANK - 1] ?? INITIAL_FRAME_MS;
    }

    private observeDelta(deltaMs : number) : void {
        if (deltaMs < MIN_PLAUSIBLE_FRAME_MS) return;
        const slot = this.deltaCount++ % ESTIMATE_WINDOW_FRAMES;
        const expired = this.recentDeltas[slot];
        if (expired !== undefined) this.sortedDeltas.splice(this.sortedDeltas.indexOf(expired), 1);
        this.recentDeltas[slot] = deltaMs;
        const longer = this.sortedDeltas.findIndex(delta => delta > deltaMs);
        this.sortedDeltas.splice(longer < 0 ? this.sortedDeltas.length : longer, 0, deltaMs);
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
     * The ratio of dropped frames to expected frames, since the construction
     * of the monitor or the last `resetCounters()`.
     *
     * The value is `droppedTotal / (observedFrames + droppedTotal)`. It is the
     * fraction of *intended* frames that the engine did not deliver. At a
     * rate of 50%, the engine skipped half of the expected frames.
     */
    getDroppedFrameRate() : number {
        const expected = this.observedFrames + this.droppedTotal;
        if (expected === 0) return 0;
        return this.droppedTotal / expected;
    }

    /** The total number of dropped frames since the construction or the last `resetCounters()`. */
    getDroppedTotal() : number {
        return this.droppedTotal;
    }

    /** The total number of observed frames since the construction or the last `resetCounters()`. */
    getObservedTotal() : number {
        return this.observedFrames;
    }

    resetCounters() : void {
        this.observedFrames = 0;
        this.droppedTotal = 0;
    }

    private scheduleNextFrame() : void {
        if (!this.started) return;
        const handle : number = this.requestAnimationFrameFn((time) => this.onFrame(handle, time));
        this.handle = handle;
    }

    /**
     * `handle` identifies the chain of this callback, because `report()` can
     * stop or restart the monitor. `time` is the frame timestamp.
     */
    private onFrame(handle : number, time : number) : void {
        if (!this.started || this.handle !== handle) return;

        try {
            // A shim of requestAnimationFrame can call the callback without a frame timestamp
            const now = Number.isFinite(time) ? time : this.clock.now();
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
