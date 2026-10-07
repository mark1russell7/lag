/** A session window ends after a gap of more than this. */
const SESSION_GAP_MS = 1_000;
/** A session window is at most this long. */
const SESSION_MAX_MS = 5_000;

/**
 * This class calculates Cumulative Layout Shift (CLS) from layout-shift
 * entries.
 *
 * The calculator puts the shifts into session windows. A window ends after
 * a gap of more than 1 second, or when it is 5 seconds long. CLS is the
 * score of the worst window. The caller must leave out the shifts that
 * followed user input (`hadRecentInput`).
 */
export class ClsCalculator {
    private sessionValue = 0;
    private sessionStart = -1;
    private lastShiftTime = -1;
    private worstSessionValue = 0;
    /** The largest single shift in the worst session window, with its sources. */
    private largestShift : { value : number; sources : readonly unknown[] } | undefined;
    private largestShiftInSession : { value : number; sources : readonly unknown[] } | undefined;

    /** This method adds one shift and gives the score of its session window. */
    add(startTime : number, value : number, sources : readonly unknown[] = []) : number {
        if (
            this.sessionStart < 0 ||
            startTime - this.lastShiftTime > SESSION_GAP_MS ||
            startTime - this.sessionStart > SESSION_MAX_MS
        ) {
            this.sessionValue = 0;
            this.sessionStart = startTime;
            this.largestShiftInSession = undefined;
        }

        this.sessionValue += value;
        this.lastShiftTime = startTime;
        if (!this.largestShiftInSession || value > this.largestShiftInSession.value) {
            this.largestShiftInSession = { value, sources };
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

    reset() : void {
        this.sessionValue = 0;
        this.sessionStart = -1;
        this.lastShiftTime = -1;
        this.worstSessionValue = 0;
        this.largestShift = undefined;
        this.largestShiftInSession = undefined;
    }
}
