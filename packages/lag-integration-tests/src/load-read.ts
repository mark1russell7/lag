import type { TimerStall } from "./timer-watch.js";

/**
 * This module decides if the load cases of `drift-load.test.ts` read anything.
 * A page that the browser holds on a grid of 1 s gives no window in the load, so these cases cannot decide on that page.
 * That result is "no read". It is not a pass.
 */

/** The step of the grid of WebKit, in milliseconds. */
const GRID_MS = 1_000;

/** A gap is on the grid when it is this near to a multiple of the grid. The tasks of the load are 30 ms or shorter. */
const GRID_TOLERANCE_MS = 50;

/** The chain of a page on the grid has at least this number of gaps on the grid. */
const MIN_GAPS_ON_GRID = 3;

/** The chain of a page on the grid has at most this number of other gaps: the way in, and the part step at the stop. */
const MAX_GAPS_OFF_GRID = 2;

/** These versions of Safari showed the grid on a CI runner, on the runner image `20261102.0473`. */
const SAFARI_VERSIONS_ON_GRID : readonly string[] = ["27.2"];

/** The first time, in UTC, at which a no read fails the job. The last day of the no read is 12 November 2026. */
export const NO_READ_ENDS_AT = Date.UTC(2026, 10, 13);

/** The result of the load cases on one page. */
export type LoadRead = "read" | "no-read" | "no-read-ended";

/** The facts that decide the result of the load cases. */
export type LoadFacts = {
    /** The number of windows that ended in the second half of the load. */
    readonly lateWindows : number;
    /** The gaps of the chain of 5 ms timers. */
    readonly stalls : readonly TimerStall[];
    /** The user agent of the browser. */
    readonly userAgent : string;
    /** The time of the read, in milliseconds since the epoch. */
    readonly now : number;
};

/** This function gives the version of Safari from a user agent, or `undefined` for another browser. */
export function safariVersion(userAgent : string) : string | undefined {
    if (/Chrome|Chromium|Edg|Firefox/.test(userAgent)) return undefined;
    return /Version\/(\d+(?:\.\d+)*) Safari\//.exec(userAgent)?.[1];
}

/** This function tells if a gap is near to a multiple of the grid. */
function onGrid(gapMs : number) : boolean {
    return gapMs >= GRID_MS - GRID_TOLERANCE_MS && Math.abs(gapMs - Math.round(gapMs / GRID_MS) * GRID_MS) <= GRID_TOLERANCE_MS;
}

/**
 * This function tells if the gaps of a chain sit on the grid.
 * A monitor that blocks the thread makes gaps off the grid, so its chain does not pass.
 * A monitor that blocks for a multiple of 1 s, or for only two gaps, does pass: this check cannot see it.
 */
export function chainOnGrid(stalls : readonly TimerStall[]) : boolean {
    const gaps = stalls.map(stall => stall.end - stall.start);
    const on = gaps.filter(onGrid).length;
    return on >= MIN_GAPS_ON_GRID && gaps.length - on <= MAX_GAPS_OFF_GRID;
}

/**
 * This function gives the result of the load cases.
 * The result is `read` when a window ended in the load. The test then does its checks.
 * The result is also `read` when no window ended on a page off the grid. The check of the windows then fails.
 */
export function loadRead(facts : LoadFacts) : LoadRead {
    if (facts.lateWindows > 0) return "read";
    const version = safariVersion(facts.userAgent);
    if (version === undefined || !SAFARI_VERSIONS_ON_GRID.includes(version)) return "read";
    if (!chainOnGrid(facts.stalls)) return "read";
    return facts.now < NO_READ_ENDS_AT ? "no-read" : "no-read-ended";
}
