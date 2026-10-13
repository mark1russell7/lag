import { useEffect, useRef, useState } from "react";
import { formatMs } from "../../lib/format";
import styles from "./Hero.module.css";

/** The time of one sweep from the left to the right, in ms. A full cycle is two sweeps. */
const SWEEP_MS = 1200;
/** A frame gap of this length or more shows the "lost" mark. */
const LOST_MS = 50;
/** The time that the mark shows. A shorter gap does not replace a longer gap in this time. */
const LOST_SHOW_MS = 3500;
/** The first frames after a start can be slow (the page renders). They show no mark. */
const QUIET_START_MS = 1000;
const FRAME_MS = 1000 / 60;

/** The position (0 to 1) of a dot at the time `now`: left to right, then right to left. */
export function sweepPosition(now : number, sweepMs = SWEEP_MS) : number {
    const phase = (now % (2 * sweepMs)) / sweepMs;
    return phase <= 1 ? phase : 2 - phase;
}

/**
 * Two dots that move in the same way. The main thread moves the first dot
 * in each `requestAnimationFrame` callback. The compositor moves the second
 * dot with a CSS animation. When a long task blocks the main thread, the
 * first dot stops, but the second dot continues. After the block, the first
 * dot jumps to its position, and a red mark shows the lost time.
 */
export function MotionLanes({ playing } : { playing : boolean }) {
    const rootRef = useRef<HTMLDivElement>(null);
    const mainRef = useRef<HTMLSpanElement>(null);
    const lostRef = useRef<HTMLSpanElement>(null);
    const [visible, setVisible] = useState(true);
    const running = playing && visible;
    // At each start, the CSS animation starts again at the phase of the main-thread dot. Thus the two dots move together.
    const [delayMs, setDelayMs] = useState(0);
    useEffect(() => {
        if (running) setDelayMs(-(performance.now() % (2 * SWEEP_MS)));
    }, [running]);

    useEffect(() => {
        const root = rootRef.current;
        if (!root || typeof IntersectionObserver === "undefined") return undefined;
        const observer = new IntersectionObserver(entries => setVisible(entries.some(entry => entry.isIntersecting)));
        observer.observe(root);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        const dot = mainRef.current;
        if (!running || !dot || typeof requestAnimationFrame === "undefined") return undefined;
        let frame = 0;
        let last : number | undefined;
        let shown = { gapMs : 0, at : Number.NEGATIVE_INFINITY };
        const startedAt = performance.now();
        // A hidden page gets no frames. That time is not lost: the next frame starts a new gap.
        const onVisibility = () : void => { last = undefined; };
        const step = (time : number) : void => {
            dot.style.transform = `translateX(${(sweepPosition(performance.now()) * 100).toFixed(2)}%)`;
            const gapMs = last === undefined ? 0 : time - last;
            if (gapMs >= LOST_MS && time - startedAt >= QUIET_START_MS && (gapMs > shown.gapMs || time - shown.at > LOST_SHOW_MS)) {
                showLost(lostRef.current, gapMs);
                shown = { gapMs, at : time };
            }
            last = time;
            frame = requestAnimationFrame(step);
        };
        frame = requestAnimationFrame(step);
        document.addEventListener("visibilitychange", onVisibility);
        return () => {
            cancelAnimationFrame(frame);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [running]);

    return (
        <div ref={rootRef} className={styles.motion} data-playing={running ? "" : undefined}>
            <div className={styles.motionLane}>
                <span className={styles.motionLabel}>Main thread <span className={styles.motionApi}>requestAnimationFrame</span></span>
                <span className={styles.motionTrack}>
                    <span className={styles.motionRail}>
                        <span ref={mainRef} className={styles.motionRunner} aria-hidden="true"><span className={styles.dot} /></span>
                    </span>
                    <span ref={lostRef} className={styles.lost} role="status" />
                </span>
            </div>
            <div className={styles.motionLane}>
                <span className={styles.motionLabel}>Compositor <span className={styles.motionApi}>CSS animation</span></span>
                <span className={styles.motionTrack}>
                    <span className={styles.motionRail}>
                        <span
                            key={delayMs}
                            className={`${styles.motionRunner} ${styles.compositor}`}
                            style={{ animationDelay : `${delayMs.toFixed(0)}ms`, animationDuration : `${SWEEP_MS}ms` }}
                            aria-hidden="true"
                        >
                            <span className={styles.dot} />
                        </span>
                    </span>
                </span>
            </div>
        </div>
    );
}

/** The red mark of the lost time: the text, and an animation of its opacity. The compositor does the animation. */
function showLost(element : HTMLSpanElement | null, gapMs : number) : void {
    if (!element) return;
    const dropped = Math.max(0, Math.round(gapMs / FRAME_MS) - 1);
    element.textContent = `${formatMs(gapMs)} without a frame, ${dropped} frames lost`;
    element.getAnimations().forEach(animation => animation.cancel());
    element.animate([{ opacity : 1 }, { opacity : 1, offset : 0.7 }, { opacity : 0 }], { duration : LOST_SHOW_MS, easing : "ease-in", fill : "forwards" });
}
