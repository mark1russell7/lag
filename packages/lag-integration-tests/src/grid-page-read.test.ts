import { describe, it } from "vitest";
import { pageState, watchAnimationFrames } from "./animation-frames.js";
import { wait } from "./harness.js";
import { environment } from "./commands.js";
import { watchTimers } from "./timer-watch.js";

/**
 * This read is for the cause of the grid of 1 s in Safari on a CI runner. It has no check: a job prints one row.
 * The chain of 5 ms timers runs in four periods, in this order. The first and the last period have the same page.
 */

/** The time of each period. */
const PERIOD_MS = 5_000;

type Period = {
    readonly name : string;
    readonly callbacks : number;
    readonly longestGapMs : number;
    readonly frames : number | null;
    readonly state : string;
};

/** This function reads the timer chain for one period. */
async function readPeriod(name : string, withFrames : boolean) : Promise<Period> {
    const timers = watchTimers({ stallMs : 50 });
    const frames = withFrames ? watchAnimationFrames() : undefined;
    await wait(PERIOD_MS);
    const frameCount = frames?.stop().count ?? null;
    const stats = timers.stop();
    return { name, callbacks : stats.count, longestGapMs : Math.round(stats.maxGapMs), frames : frameCount, state : pageState() };
}

/** This function adds a small box with a running animation to the page, and gives the function that removes it. */
function addAnimation() : () => void {
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

describe("The grid of 1 s of Safari on a CI runner", () => {
    it("reads the timer chain with and without an animation", async (ctx) => {
        ctx.skip(environment() !== "safari", "This read is for the real Safari.");
        const periods : Period[] = [];
        periods.push(await readPeriod("no animation, first", false));
        periods.push(await readPeriod("a loop of animation frames", true));
        const remove = addAnimation();
        periods.push(await readPeriod("a running animation", false));
        remove();
        periods.push(await readPeriod("no animation, last", false));
        console.log(`grid-page read ${JSON.stringify({ userAgent : navigator.userAgent, periods })}`);
    }, 60_000);
});
