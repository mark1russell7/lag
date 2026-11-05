import { describe, expect, it } from "vitest";
import { countIosAttempts, isWrongRecord, needsIssue, readIosLog, renderIosCount, type IosAttempt } from "./ios-count.js";

const OFF_TEST = "src/offscreen-frame.test.ts > A frame off the screen > without the frame viewport, DriftLag finds the throttled timers of WebKit and records no window of them";

/** Lines of real logs of the job. */
const line = (viewport : boolean, drift : string, gap : number) : string =>
    `2026-10-27T07:33:07.6848840Z ios${viewport ? "" : ", without the frame viewport"}: longest step of a 100 ms timeout chain in the frame off the screen 1004 ms; records off the screen {"lag_drift_histogram":[${drift}],"lag_macrotask_histogram":[0]}; longest frame gap after ${gap} ms`;
const failLine = `2026-10-27T07:33:57.4153820Z  FAIL   browser (ios)  ${OFF_TEST}`;

const attempt = (log : string, conclusion = "failure", url = "https://example.test/1") : IosAttempt => ({ ...readIosLog(log), conclusion, url });

describe("readIosLog", () => {
    it("reads a failed test one time, without the project, also with color codes", () => {
        const colored = `\u001b[31m${failLine}\u001b[39m`;
        expect(readIosLog(`${failLine}\n${colored}\n`).failed).toEqual([OFF_TEST]);
    });

    it("reads each line of the test of a frame off the screen", () => {
        const read = readIosLog(`${line(true, "", 31)}\n${line(false, "2494", 31)}\n`);
        expect(read.offScreen).toEqual([
            { viewport : true, driftMs : [], frameGapMs : 31, busyChecksMs : [] },
            { viewport : false, driftMs : [2494], frameGapMs : 31, busyChecksMs : [] },
        ]);
    });

    it("reads the busy time of each check from a new line", () => {
        expect(readIosLog(`${line(false, "2494", 31)}; busy checks [30,47]\n`).offScreen[0]?.busyChecksMs).toEqual([30, 47]);
    });

    it("reads nothing from other lines", () => {
        expect(readIosLog("Run pnpm build\nno FAIL word at the start of this line\n")).toEqual({ failed : [], offScreen : [] });
    });
});

describe("isWrongRecord", () => {
    it("takes a drift value or a frame gap of 1 s or more, and only those", () => {
        expect(isWrongRecord({ viewport : false, driftMs : [2494], frameGapMs : 31, busyChecksMs : [] })).toBe(true);
        expect(isWrongRecord({ viewport : false, driftMs : [], frameGapMs : 6_017, busyChecksMs : [] })).toBe(true);
        expect(isWrongRecord({ viewport : false, driftMs : [], frameGapMs : 999, busyChecksMs : [] })).toBe(false);
    });
});

describe("countIosAttempts", () => {
    it("counts by test name and keeps the attempt of each wrong record", () => {
        const count = countIosAttempts([
            attempt(`${failLine}\n${line(false, "3085", 153)}\n`),
            attempt(`${failLine}\n${line(false, "", 6_015)}\n`, "failure", "https://example.test/2"),
            attempt(line(true, "", 31), "success", "https://example.test/3"),
        ]);
        expect(count.attempts).toBe(3);
        expect(count.failedAttempts).toBe(2);
        expect(count.byTest).toEqual([{ name : OFF_TEST, attempts : 2 }]);
        expect(count.wrong.map(row => row.url)).toEqual(["https://example.test/1", "https://example.test/2"]);
    });

    it("needs an issue for a failed test, a wrong record in a passed attempt, a failure with no test name, or a log not read", () => {
        const clean = countIosAttempts([attempt(line(true, "", 31), "success")]);
        expect(needsIssue(clean)).toBe(false);
        expect(needsIssue(countIosAttempts([attempt(failLine)]))).toBe(true);
        expect(needsIssue(countIosAttempts([attempt(line(false, "2494", 31), "success")]))).toBe(true);
        expect(needsIssue(countIosAttempts([attempt("", "failure")]))).toBe(true);
        expect(needsIssue(countIosAttempts([], 1))).toBe(true);
    });
});

describe("renderIosCount", () => {
    it("says that the list of wrong records can be short, and names the values", () => {
        const text = renderIosCount(countIosAttempts([attempt(`${failLine}\n${line(false, "2494", 31)}\n`)]), 7);
        expect(text).toContain("1 finished attempts in the last 7 days. 1 failed.");
        expect(text).toContain("| [log](https://example.test/1) | no | 2494 | 31 | none |");
        expect(text).toContain("short of the real count");
    });

    it("says so when nothing failed", () => {
        expect(renderIosCount(countIosAttempts([attempt(line(true, "", 31), "success")]), 7)).toContain("No test failed");
    });
});
