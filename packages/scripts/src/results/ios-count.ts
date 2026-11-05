/**
 * This module counts the failures of the iOS simulator job of CI. A failure of this job does not fail its workflow,
 * so a person needs one place that shows the failures. The count goes by test name. A wrong record is a lag value
 * that a frame off the screen recorded: the monitors must pause there, so that value did not happen.
 */

/** The name of the job in the workflow CI. */
export const IOS_JOB = "Browser tests (Safari on iOS, simulator)";

/** A frame gap of this duration or more, off the screen, is a wrong record. The test of the frame has the same limit. */
export const WRONG_FRAME_GAP_MS = 1_000;

/** One line of the test of a frame off the screen. */
export type OffScreenRead = {
    /** True when the monitors had the frame viewport. */
    readonly viewport : boolean;
    /** The values of DriftLag that the test keeps: only the values from before the frame came back. */
    readonly driftMs : readonly number[];
    readonly frameGapMs : number;
};

/** The facts of the log of one try of the job. */
export type IosLogRead = {
    /** The name of each failed test, one time. */
    readonly failed : readonly string[];
    readonly offScreen : readonly OffScreenRead[];
};

/** One try of the job. */
export type IosAttempt = IosLogRead & {
    readonly url : string;
    readonly conclusion : string;
};

/** One wrong record, with the try that shows it. */
export type WrongRecord = OffScreenRead & { readonly url : string };

/** The count of a period. */
export type IosCount = {
    readonly attempts : number;
    readonly failedAttempts : number;
    /** The number of tries for each test name, largest first. */
    readonly byTest : ReadonlyArray<{ readonly name : string; readonly attempts : number }>;
    readonly wrong : readonly WrongRecord[];
    /** The tries with no log to read. The count does not hold them. */
    readonly unread : number;
};

const ESCAPE_CODE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const FAILED_TEST = /^(?:\d{4}-\d\d-\d\dT[\d:.]+Z)?\s*FAIL\s+(?:browser \([^)]*\)\s+)?(.+\S)\s*$/;
const OFF_SCREEN = /(, without the frame viewport)?: longest step of a 100 ms timeout chain .* records off the screen (\{.*\}); longest frame gap after (\d+) ms/;

/** This function reads the log of one try of the job. */
export function readIosLog(log : string) : IosLogRead {
    const failed = new Set<string>();
    const offScreen : OffScreenRead[] = [];
    for (const raw of log.split(/\r?\n/)) {
        const line = raw.replace(ESCAPE_CODE, "");
        const test = FAILED_TEST.exec(line);
        if (test?.[1] !== undefined) failed.add(test[1]);
        const read = OFF_SCREEN.exec(line);
        if (read?.[2] !== undefined && read[3] !== undefined) {
            const records = JSON.parse(read[2]) as { lag_drift_histogram? : number[] };
            offScreen.push({ viewport : read[1] === undefined, driftMs : records.lag_drift_histogram ?? [], frameGapMs : Number(read[3]) });
        }
    }
    return { failed : [...failed], offScreen };
}

/** This function tells if a line of the test holds a value that did not happen. */
export function isWrongRecord(read : OffScreenRead) : boolean {
    return read.driftMs.length > 0 || read.frameGapMs >= WRONG_FRAME_GAP_MS;
}

/** This function counts the tries of a period. */
export function countIosAttempts(attempts : readonly IosAttempt[], unread = 0) : IosCount {
    const byTest = new Map<string, number>();
    for (const attempt of attempts) {
        for (const name of attempt.failed) byTest.set(name, (byTest.get(name) ?? 0) + 1);
    }
    return {
        attempts : attempts.length,
        failedAttempts : attempts.filter(attempt => attempt.conclusion === "failure").length,
        byTest : [...byTest].map(([name, count]) => ({ name, attempts : count })).sort((a, b) => b.attempts - a.attempts || (a.name < b.name ? -1 : 1)),
        wrong : attempts.flatMap(attempt => attempt.offScreen.filter(isWrongRecord).map(read => ({ ...read, url : attempt.url }))),
        unread,
    };
}

/** This function tells if a count needs an issue: a test failed, a wrong record shows, or a log was not read. */
export function needsIssue(count : IosCount) : boolean {
    return count.byTest.length > 0 || count.wrong.length > 0 || count.failedAttempts > 0 || count.unread > 0;
}

/** This function gives the Markdown of a count. */
export function renderIosCount(count : IosCount, days : number) : string {
    const lines = [
        `The job \`${IOS_JOB}\` had ${count.attempts} finished attempts in the last ${days} days. ${count.failedAttempts} failed. ${count.unread} logs were not read.`,
        "",
    ];
    if (count.byTest.length > 0) {
        lines.push("| Test | Attempts |", "| --- | ---: |");
        for (const row of count.byTest) lines.push(`| ${row.name.replaceAll("|", "\\|")} | ${row.attempts} |`);
        lines.push("");
    }
    if (count.wrong.length > 0) {
        lines.push(
            "## Wrong records",
            "",
            "Each row is a lag value of a frame off the screen. The monitors must pause there, so the value did not happen. The test keeps only the values from before the frame came back, so this list can be short of the real count.",
            "",
            "| Attempt | Frame viewport | DriftLag values (ms) | Longest frame gap (ms) |",
            "| --- | --- | ---: | ---: |",
        );
        for (const row of count.wrong) lines.push(`| [log](${row.url}) | ${row.viewport ? "yes" : "no"} | ${row.driftMs.join(", ") || "none"} | ${row.frameGapMs} |`);
        lines.push("");
    }
    if (!needsIssue(count)) lines.push("No test failed, and no wrong record shows.", "");
    return lines.join("\n");
}
