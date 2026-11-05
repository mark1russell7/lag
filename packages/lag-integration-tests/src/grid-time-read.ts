import { describe, it } from "vitest";
import { readPeriod, type Period } from "./grid-read.js";

/**
 * This read is for the question: does the grid of 1 s start after some time, with no load on the page?
 * The name of this file does not end in `.test.ts`, so a normal run leaves it out.
 * The Safari job starts it alone, in a new session of Safari, with `LAG_SAFARI_READ=1`.
 */

/** The time of each period. */
const PERIOD_MS = 10_000;

/** The count of periods. The grid started 48 s to 64 s after the first test of a job. */
const PERIODS = 15;

describe("The time of the grid of 1 s of Safari on a CI runner", () => {
    it("reads the timer chain on a page with no load", async () => {
        const periods : Period[] = [];
        for (let i = 0; i < PERIODS; i++) periods.push(await readPeriod(`${(i + 1) * PERIOD_MS / 1000} s`, PERIOD_MS, false));
        console.log(`grid-time read ${JSON.stringify({ userAgent : navigator.userAgent, periods })}`);
    }, PERIODS * PERIOD_MS + 30_000);
});
