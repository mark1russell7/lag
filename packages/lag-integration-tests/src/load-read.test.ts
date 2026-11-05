import { describe, expect, it } from "vitest";
import { NO_READ_ENDS_AT, chainOnGrid, loadRead, safariVersion, type LoadFacts } from "./load-read.js";
import type { TimerStall } from "./timer-watch.js";

const SAFARI_ON_GRID = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.2 Safari/605.1.15";
const SAFARI_OFF_GRID = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.2 Safari/605.1.15";
const CHROMIUM = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0";

/** This function makes the stalls of a chain from its gaps, one after the other. */
const chain = (...gaps : readonly number[]) : TimerStall[] => {
    let at = 0;
    return gaps.map(gap => {
        const stall = { start : at, end : at + gap };
        at += gap + 5;
        return stall;
    });
};

/** A chain of a page on the grid: a way in of 377 ms, steps of 1 s, and a part step at the stop. */
const ON_THE_GRID = chain(377, 1_001, 999, 1_002, 1_000, 1_001, 412);

const facts = (over : Partial<LoadFacts> = {}) : LoadFacts => ({
    lateWindows : 0,
    stalls : ON_THE_GRID,
    userAgent : SAFARI_ON_GRID,
    now : NO_READ_ENDS_AT - 1,
    ...over,
});

describe("loadRead", () => {
    it("gives no read for a page on the grid in the Safari where the grid was read", () => {
        expect(loadRead(facts())).toBe("no-read");
    });

    it("stops the no read at its end date, so that the job fails", () => {
        expect(loadRead(facts({ now : NO_READ_ENDS_AT }))).toBe("no-read-ended");
    });

    // A flip: the test goes on to its check of the windows, and that check fails with no window
    it("does not excuse a healthy chain with no window", () => {
        expect(loadRead(facts({ stalls : [] }))).toBe("read");
    });

    // A flip: a monitor that blocks the thread makes long gaps, but not on the grid
    it("does not excuse a monitor that blocks with gaps off the grid", () => {
        expect(loadRead(facts({ stalls : chain(1_370, 2_210, 930, 1_640, 1_180, 2_730) }))).toBe("read");
    });

    it("does not excuse gaps of the grid mixed with too many others", () => {
        expect(loadRead(facts({ stalls : chain(1_000, 1_000, 1_000, 1_370, 2_210, 1_640) }))).toBe("read");
    });

    it("does not excuse another browser or another version of Safari", () => {
        for (const userAgent of [CHROMIUM, FIREFOX, SAFARI_OFF_GRID]) expect(loadRead(facts({ userAgent }))).toBe("read");
    });

    it("reads a page with a window in the load, on the grid or not", () => {
        expect(loadRead(facts({ lateWindows : 1 }))).toBe("read");
        expect(loadRead(facts({ lateWindows : 1, now : NO_READ_ENDS_AT }))).toBe("read");
    });
});

describe("chainOnGrid", () => {
    it("counts a gap of some steps of the grid", () => {
        expect(chainOnGrid(chain(2_003, 1_000, 3_001))).toBe(true);
    });

    it("asks for at least three gaps on the grid", () => {
        expect(chainOnGrid(chain(1_000, 1_000))).toBe(false);
    });

    it("holds the tolerance at 50 ms on both sides", () => {
        expect(chainOnGrid(chain(950, 1_050, 1_000))).toBe(true);
        expect(chainOnGrid(chain(949, 1_051, 1_000))).toBe(false);
    });
});

describe("safariVersion", () => {
    it("reads Safari, and no other browser", () => {
        expect(safariVersion(SAFARI_ON_GRID)).toBe("27.2");
        expect(safariVersion(SAFARI_OFF_GRID)).toBe("26.6.2");
        expect(safariVersion(CHROMIUM)).toBeUndefined();
        expect(safariVersion(FIREFOX)).toBeUndefined();
    });
});
