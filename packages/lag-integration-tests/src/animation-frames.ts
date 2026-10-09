/** The animation frames that the browser gave the page in a period. */
export type FrameStats = {
    /** The number of animation frames. */
    count : number;
    /**
     * The longest time without a frame: between two frames, from the start
     * to the first frame, or from the last frame to the stop.
     */
    maxGapMs : number;
};

export type FrameWatch = { stop() : FrameStats };

/**
 * This function counts the animation frames of the page until `stop()`.
 *
 * Safari on a CI runner sometimes renders no frames for its window, also
 * when `visibilityState` is "visible". Then the browser does not start the
 * callbacks of `requestAnimationFrame`. A test that needs frames can then
 * tell this case from an error of a monitor: the watch counts the frames of
 * the browser itself.
 */
export function watchAnimationFrames() : FrameWatch {
    const start = performance.now();
    let last = start;
    let count = 0;
    let maxGapMs = 0;
    let stopped = false;
    const tick = () : void => {
        if (stopped) return;
        const now = performance.now();
        maxGapMs = Math.max(maxGapMs, now - last);
        last = now;
        count++;
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return {
        stop() {
            stopped = true;
            maxGapMs = Math.max(maxGapMs, performance.now() - last);
            return { count, maxGapMs };
        },
    };
}

/** The state of the page, for the reason of a skip. */
export function pageState() : string {
    return `visibilityState "${document.visibilityState}", hasFocus ${document.hasFocus()}, window ${window.innerWidth}x${window.innerHeight}`;
}
