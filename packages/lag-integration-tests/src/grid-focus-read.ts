import { describe, it } from "vitest";
import { userEvent } from "vitest/browser";
import { pageState } from "./animation-frames.js";
import { readPeriod, type Period } from "./grid-read.js";

/**
 * This read is for the question: does the grid of 1 s start after some time on a page with focus and no load?
 * A page with no focus fell to the grid after 50 s to 70 s (`grid-time-read.ts`). This read gives the page focus with one real
 * click, and then gives it no input and no load. The name of this file does not end in `.test.ts`, so a normal run leaves it out.
 * The Safari job starts it alone, in a new session of Safari, with `LAG_SAFARI_READ=focus`.
 */

/** The time of each period. */
const PERIOD_MS = 10_000;

/** The count of periods, the same as in `grid-time-read.ts`. */
const PERIODS = 15;

describe("The grid of 1 s of Safari on a CI runner, on a page with focus", () => {
    it("reads the timer chain on a page with focus and no load", async () => {
        const before = pageState();
        const button = document.createElement("button");
        button.textContent = "focus";
        document.body.append(button);
        await userEvent.click(button);
        window.focus();
        const after = pageState();
        button.remove();
        const periods : Period[] = [];
        for (let i = 0; i < PERIODS; i++) periods.push(await readPeriod(`${(i + 1) * PERIOD_MS / 1000} s`, PERIOD_MS, false));
        console.log(`grid-focus read ${JSON.stringify({ userAgent : navigator.userAgent, before, after, periods })}`);
    }, PERIODS * PERIOD_MS + 30_000);
});
