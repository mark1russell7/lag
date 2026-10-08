/**
 * The rules of the DriftLag baseline (refer to `DriftLag`). The functions
 * have no state, thus a test can examine each limit exactly.
 */

/**
 * A step is a block, not jitter, if it is longer than the median plus the
 * larger of this value and half the median.
 */
export const MIN_JITTER_MS = 4;

/** The steps of one granularity agree within the larger of these two values. */
const GRANULARITY_SPREAD_MS = 2;
const GRANULARITY_SPREAD_RATIO = 0.2;

/**
 * The baseline can increase above the confirmed value by the larger of these
 * two values without a probe.
 */
const RISE_WITHOUT_PROBE_MS = 1;
const RISE_WITHOUT_PROBE_RATIO = 0.1;

/**
 * A probed step is idle if the busy time is less than the larger of this
 * value and half the extra duration.
 */
const IDLE_BUSY_MS = 2;

function median(sorted : readonly number[]) : number {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

/**
 * The idle duration of one step: the mean of the steps that are not blocks.
 * The function uses the mean, not the median, because timer jitter is
 * skewed to the right. With the median, an idle window shows a few
 * milliseconds of lag. `steps` must contain one step or more. The median is
 * not a block, thus the mean contains one step or more.
 */
export function idleStepMs(steps : readonly number[]) : number {
    const sorted = [...steps].sort((a, b) => a - b);
    const typical = median(sorted);
    const limit = typical + Math.max(MIN_JITTER_MS, typical / 2);
    let sum = 0;
    let count = 0;
    for (const step of sorted) {
        if (step > limit) break;
        sum += step;
        count++;
    }
    return sum / count;
}

/** Two steps of one granularity agree if they differ by not more than this value: max(2 ms, 20%). */
export function spreadMs(stepMs : number) : number {
    return Math.max(GRANULARITY_SPREAD_MS, GRANULARITY_SPREAD_RATIO * stepMs);
}

/**
 * The baseline that the monitor uses. It is the recent baseline, or the
 * confirmed value if the recent baseline is more than max(1 ms, 10%) above
 * it. Without a confirmed value, it is the recent baseline.
 */
export function usedBaselineMs(recentMs : number, confirmedMs : number | undefined) : number {
    const confirmed = confirmedMs ?? Infinity;
    return recentMs > confirmed + Math.max(RISE_WITHOUT_PROBE_MS, RISE_WITHOUT_PROBE_RATIO * confirmed) ? confirmed : recentMs;
}

/**
 * True if a probed step was idle: the thread was busy for less than
 * max(2 ms, half of the extra duration of the step above the baseline).
 * A busy time of that length does not explain the extra duration.
 */
export function isIdleStep(stepMs : number, baselineMs : number, busyMs : number) : boolean {
    return busyMs < Math.max(IDLE_BUSY_MS, (stepMs - baselineMs) / 2);
}

/** The steps that are not longer than `limitMs`, in the same sequence. */
export function stepsUpTo(steps : readonly number[], limitMs : number) : number[] {
    return steps.filter(step => step <= limitMs);
}

/** What a check shows: a new confirmed value, or the limit above which the recent steps are load. */
export type CheckFinding = { confirmedMs : number } | { loadAboveMs : number };

/**
 * This function examines the steps of a check: the steps between two idle
 * probes. If they do not agree with each other, there is no finding.
 *
 * - Without a confirmed value, the first confirmed value is the recent
 *   baseline. A value that is too high (from a load before the check)
 *   decreases with the recent baseline. Three steps can be too short, for
 *   example in Firefox after a load, and a value that is too low causes lag.
 * - Otherwise, the mean of the steps is an idle duration of one step. If it
 *   agrees better with the confirmed value than with the recent baseline,
 *   the confirmed value stays, and the longer recent steps were load. The
 *   limit is the larger of the confirmed value plus its spread and the idle
 *   duration plus its spread.
 * - Otherwise, the new confirmed value is the lower of the recent baseline
 *   and the idle duration. A load can make the recent baseline longer, but
 *   not shorter.
 */
export function interpretCheck(idleSteps : readonly number[], recentMs : number, confirmedMs : number | undefined) : CheckFinding | undefined {
    const longest = Math.max(...idleSteps);
    if (longest - Math.min(...idleSteps) > spreadMs(longest)) return undefined;
    if (confirmedMs === undefined) return { confirmedMs : recentMs };
    const idleMs = idleSteps.reduce((sum, step) => sum + step, 0) / idleSteps.length;
    if (Math.abs(idleMs - confirmedMs) <= Math.abs(idleMs - recentMs)) {
        return { loadAboveMs : Math.max(confirmedMs + spreadMs(confirmedMs), idleMs + spreadMs(idleMs)) };
    }
    return { confirmedMs : Math.min(recentMs, idleMs) };
}
