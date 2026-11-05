import { pageState, watchAnimationFrames } from "./animation-frames.js";
import { wait } from "./harness.js";
import { watchTimers } from "./timer-watch.js";

/**
 * These parts are for the reads of the grid of 1 s in Safari on a CI runner. A read has no check: a job prints one row.
 */

/** This type is the result of one period of a chain of 5 ms timers. */
export type Period = {
    readonly name : string;
    readonly callbacks : number;
    readonly longestGapMs : number;
    readonly frames : number | null;
    readonly state : string;
};

/** This function reads the timer chain for one period. */
export async function readPeriod(name : string, periodMs : number, withFrames : boolean) : Promise<Period> {
    const timers = watchTimers({ stallMs : 50 });
    const frames = withFrames ? watchAnimationFrames() : undefined;
    await wait(periodMs);
    const frameCount = frames?.stop().count ?? null;
    const stats = timers.stop();
    return { name, callbacks : stats.count, longestGapMs : Math.round(stats.maxGapMs), frames : frameCount, state : pageState() };
}

/** This function adds a small box with a running animation to the page, and gives the function that removes it. */
export function addAnimation() : () => void {
    const style = document.createElement("style");
    style.textContent = "@keyframes grid-page-read { from { transform: translateX(0); } to { transform: translateX(40px); } }";
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:0;top:0;width:20px;height:20px;background:#888;animation:grid-page-read 1s linear infinite alternate";
    document.head.append(style);
    document.body.append(box);
    return () => {
        box.remove();
        style.remove();
    };
}
