import { describe, it } from "vitest";
import { environment } from "./commands.js";
import { addAnimation, readPeriod, type Period } from "./grid-read.js";

/**
 * This read is for the cause of the grid of 1 s in Safari on a CI runner. It has no check: a job prints one row.
 * The chain of 5 ms timers runs in four periods, in this order. The first and the last period have the same page.
 */

/** The time of each period. */
const PERIOD_MS = 5_000;

describe("The grid of 1 s of Safari on a CI runner", () => {
    it("reads the timer chain with and without an animation", async (ctx) => {
        ctx.skip(environment() !== "safari", "This read is for the real Safari.");
        const periods : Period[] = [];
        periods.push(await readPeriod("no animation, first", PERIOD_MS, false));
        periods.push(await readPeriod("a loop of animation frames", PERIOD_MS, true));
        const remove = addAnimation();
        periods.push(await readPeriod("a running animation", PERIOD_MS, false));
        remove();
        periods.push(await readPeriod("no animation, last", PERIOD_MS, false));
        console.log(`grid-page read ${JSON.stringify({ userAgent : navigator.userAgent, periods })}`);
    }, 60_000);
});
