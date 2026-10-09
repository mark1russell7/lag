/** A session window ends at a gap of this or more. */
const SESSION_GAP_MS = 1_000;
/** A session window is shorter than this. */
const SESSION_MAX_MS = 5_000;

/**
 * This class calculates Cumulative Layout Shift (CLS) from layout-shift
 * entries.
 *
 * The calculator puts the shifts into session windows. A window ends at a
 * gap of 1 second or more, or when it is 5 seconds long, as in web-vitals.
 * CLS is the score of the worst window. The caller must leave out the
 * shifts that followed user input (`hadRecentInput`).
 */
export class ClsCalculator {
    private sessionValue = 0;
    private sessionStart = -1;
    private lastShiftTime = -1;
    private worstSessionValue = 0;
    /** The largest single shift in the worst session window, with its sources and its time. */
    private largestShift : { value : number; sources : readonly unknown[]; time : number } | undefined;
    private largestShiftInSession : { value : number; sources : readonly unknown[]; time : number } | undefined;

    /** This method adds one shift and gives the score of its session window. */
    add(startTime : number, value : number, sources : readonly unknown[] = []) : number {
        if (
            this.sessionStart < 0 ||
            startTime - this.lastShiftTime >= SESSION_GAP_MS ||
            startTime - this.sessionStart >= SESSION_MAX_MS
        ) {
            this.sessionValue = 0;
            this.sessionStart = startTime;
            this.largestShiftInSession = undefined;
        }

        this.sessionValue += value;
        this.lastShiftTime = startTime;
        // As web-vitals: of two shifts with the same score, the later one is the largest
        if (!this.largestShiftInSession || value >= this.largestShiftInSession.value) {
            this.largestShiftInSession = { value, sources, time : startTime };
        }

        if (this.sessionValue > this.worstSessionValue) {
            this.worstSessionValue = this.sessionValue;
            this.largestShift = this.largestShiftInSession;
        }
        return this.sessionValue;
    }

    getCLS() : number {
        return this.worstSessionValue;
    }

    /** The sources of the largest shift in the worst session window (for attribution). */
    getLargestShiftSources() : readonly unknown[] {
        return this.largestShift?.sources ?? [];
    }

    /** The start time of the largest shift in the worst session window, as `largestShiftTime` of web-vitals. */
    getLargestShiftTime() : number | undefined {
        return this.largestShift?.time;
    }

    reset() : void {
        this.sessionValue = 0;
        this.sessionStart = -1;
        this.lastShiftTime = -1;
        this.worstSessionValue = 0;
        this.largestShift = undefined;
        this.largestShiftInSession = undefined;
    }
}
