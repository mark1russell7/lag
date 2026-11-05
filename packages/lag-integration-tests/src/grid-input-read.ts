import { describe, it } from "vitest";
import { userEvent } from "vitest/browser";
import { pageState } from "./animation-frames.js";
import { readPeriod, type Period } from "./grid-read.js";

/**
 * This read is for the question: does input hold off the grid of 1 s, or does the grid start a time after the page loads?
 * With one click at the start, the grid started after 50 s to 60 s (`grid-focus-read.ts`). This read gives the page a real
 * click at the start of each second period. Thus the last input is at most 20 s old. The page has no load.
 * The name of this file does not end in `.test.ts`, so a normal run leaves it out.
 * The Safari job starts it alone, in a new session of Safari, with `LAG_SAFARI_READ=input`.
 */

/** The time of each period. */
const PERIOD_MS = 10_000;

/** The count of periods, the same as in `grid-time-read.ts`. */
const PERIODS = 15;

/** The count of periods from one click to the next. */
const PERIODS_PER_CLICK = 2;

describe("The grid of 1 s of Safari on a CI runner, on a page with input", () => {
    it("reads the timer chain on a page with a real click each 20 s and no load", async () => {
        const before = pageState();
        const button = document.createElement("button");
        button.textContent = "input";
        document.body.append(button);
        const periods : Array<Period & { readonly clicked : boolean }> = [];
        for (let i = 0; i < PERIODS; i++) {
            const clicked = i % PERIODS_PER_CLICK === 0;
            if (clicked) await userEvent.click(button);
            periods.push({ ...await readPeriod(`${(i + 1) * PERIOD_MS / 1000} s`, PERIOD_MS, false), clicked });
        }
        button.remove();
        console.log(`grid-input read ${JSON.stringify({ userAgent : navigator.userAgent, before, periods })}`);
    }, PERIODS * PERIOD_MS + 60_000);
});
