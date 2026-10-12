/** A gap of the timer chain that is longer than the stall limit, in the time of `performance.now()`. */
export type TimerStall = { start : number; end : number };

/** The callbacks of a chain of short timers in a period. */
export type TimerStats = {
    /** The number of callbacks. */
    count : number;
    /**
     * The longest time without a callback: between two callbacks, from the
     * start to the first callback, or from the last callback to the stop.
     */
    maxGapMs : number;
    /** The gaps that are longer than the stall limit, oldest first. */
    stalls : TimerStall[];
    /** The longest time without a stall: between two stalls, or between a stall and the start or the stop. */
    longestRunMs : number;
};

export type TimerWatch = {
    /** The time of each callback, oldest first, in the time of `performance.now()`. */
    readonly times : readonly number[];
    stop() : TimerStats;
};

export type TimerWatchOptions = {
    /** The delay of each timer. The default is 5 ms, the step of DriftLag. */
    stepMs? : number;
    /** A gap that is longer than this value is a stall. The default is 1,000 ms. */
    stallMs? : number;
};

/**
 * This function starts a chain of short timers. It records the time of each
 * callback until `stop()`.
 *
 * The iOS Simulator on a CI runner sometimes stops the timers of the page,
 * for more than 20 s one time. Then a monitor that uses a timer cannot
 * sample. The watch measures the timers of the browser itself. Thus a test
 * can tell a stop of the timers from an error of a monitor: if the timers
 * operated, the monitor must sample.
 */
export function watchTimers(options : TimerWatchOptions = {}) : TimerWatch {
    const stepMs = options.stepMs ?? 5;
    const stallMs = options.stallMs ?? 1_000;
    const start = performance.now();
    const times : number[] = [];
    let handle = setTimeout(function tick() {
        times.push(performance.now());
        handle = setTimeout(tick, stepMs);
    }, stepMs);
    return {
        times,
        stop() {
            clearTimeout(handle);
            return timerStats(start, times, performance.now(), stallMs);
        },
    };
}

/** This function gives the statistics of the callbacks at `times`, from `start` to `end`. */
export function timerStats(start : number, times : readonly number[], end : number, stallMs : number) : TimerStats {
    const points = [start, ...times, end];
    const stalls : TimerStall[] = [];
    let maxGapMs = 0;
    let longestRunMs = 0;
    let runStart = start;
    for (let i = 1; i < points.length; i++) {
        const gap = points[i]! - points[i - 1]!;
        maxGapMs = Math.max(maxGapMs, gap);
        if (gap <= stallMs) continue;
        stalls.push({ start : points[i - 1]!, end : points[i]! });
        longestRunMs = Math.max(longestRunMs, points[i - 1]! - runStart);
        runStart = points[i]!;
    }
    longestRunMs = Math.max(longestRunMs, end - runStart);
    return { count : times.length, maxGapMs, stalls, longestRunMs };
}

/** This function gives the times between two callbacks of `times` that are both from `from` to `to`, oldest first. */
export function gapsBetween(times : readonly number[], from : number, to : number) : number[] {
    const gaps : number[] = [];
    for (let i = 1; i < times.length; i++) {
        if (times[i - 1]! >= from && times[i]! <= to) gaps.push(times[i]! - times[i - 1]!);
    }
    return gaps;
}
