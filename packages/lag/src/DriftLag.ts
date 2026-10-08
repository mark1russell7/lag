import { driftStepMs } from "./constants.js";
import { LagMonitor } from "./LagMonitor.js";

export type DriftLagOptions = {
    /** The requested delay of each timer step. The default is `driftStepMs` (5 ms). */
    stepMs? : number;
    /** The number of recent steps that give the baseline. The default is 100. */
    baselineSteps? : number;
};

const DEFAULT_BASELINE_STEPS = 100;

/**
 * A step is a block, not jitter, if it is longer than the median plus the
 * larger of this value and half the median.
 */
const MIN_JITTER_MS = 4;

/**
 * The monitor accepts a new timer granularity after this number of steps in
 * a row that agree with each other, but not with the baseline.
 */
const GRANULARITY_CHANGE_STEPS = 10;

/** The steps of one granularity agree within the larger of these two values. */
const GRANULARITY_SPREAD_MS = 2;
const GRANULARITY_SPREAD_RATIO = 0.2;

/**
 * The longest step that a timer granularity gives, with a margin. Examples
 * are two ticks of the Windows timer (31.25 ms) and the 30 ms grid of WebKit
 * in Low Power Mode. A row of longer steps is lag, not a granularity.
 */
const MAX_GRANULARITY_MS = 40;

function median(sorted : readonly number[]) : number {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!;
}

/**
 * The idle duration of one step: the mean of the steps that are not blocks.
 * The function uses the mean, not the median, because timer jitter is
 * skewed to the right. With the median, an idle window shows a few
 * milliseconds of lag.
 */
function idleStepMs(steps : readonly number[]) : number {
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
    return count > 0 ? sum / count : typical;
}

/**
 * This monitor measures event-loop lag with a chain of short timeouts. A
 * block anywhere in the window delays the chain. Thus, the lag of a window
 * contains all the blocking in it. One long timeout finds only a block at
 * its deadline.
 *
 * Calibration: a timer step takes longer than its requested delay, also on
 * an idle thread. The extra time comes from the timer granularity of the
 * browser and the operating system. On an idle page on Windows, a 5 ms step
 * takes approximately 5.7 ms in Chromium. It takes 16 ms in Firefox and
 * WebKit, because of the 15.6 ms timer tick of the system. WebKit on macOS
 * aligns nested timers to a grid of 4 ms, or 30 ms in Low Power Mode.
 *
 * Thus, the monitor calculates the idle duration of one step from the recent
 * steps. This value is the baseline. It is the mean of the steps that are
 * not longer than the median plus max(4 ms, half the median). The lag of a
 * window is its duration minus the number of steps multiplied by the
 * baseline. The number of steps changes with the baseline, so that a window
 * stays near `expectedElapsedTimeMs`.
 *
 * A long step is a block, not jitter. Thus, a block does not change the
 * baseline. If the thread is busy during more than half of the steps, the
 * baseline increases and the monitor reports less lag. The worker monitor
 * measures that case correctly.
 *
 * The timer granularity can change while the monitor operates. For example,
 * Windows can change the timer resolution of the browser process on battery
 * power, or when a window is hidden and shown again. Then all steps change
 * by the same quantity, also on an idle thread. A block makes one step long,
 * and the next steps are normal again. Thus, a row of 10 steps that agree
 * with each other, but not with the baseline, starts a new baseline.
 *
 * A window that ends during such a row continues until the row ends, or
 * until the monitor accepts the new granularity. Thus, the change gives no
 * lag. Steps of more than 40 ms are not a granularity. A row of consistent
 * shorter steps looks like a granularity, for example on a busy thread with
 * tasks of the same length. The worker monitor measures that case too.
 */
export class DriftLag extends LagMonitor {
    private handle : number | undefined;
    private windowStart = 0;
    private lastStepAt = 0;
    private stepsInWindow = 0;
    private stepsPerWindow : number;
    private lastWindowMs = 0;
    /** The baseline at the end of the last window. The monitor compares each new step with it. */
    private windowBaseline : number;
    /** The steps in a row that agree with each other, but not with `windowBaseline`. */
    private rowCount = 0;
    private rowMin = Infinity;
    private rowMax = -Infinity;
    private readonly stepMs : number;
    private readonly maxSteps : number;
    private readonly baselineSize : number;
    /** The durations of the recent steps, oldest first. */
    private readonly recentSteps : number[] = [];

    constructor(...args : [...ConstructorParameters<typeof LagMonitor>, options? : DriftLagOptions]) {
        const [expectedElapsedTimeMs, report, logger, setIntervalFn, clearIntervalFn, setTimeoutFn, clearTimeoutFn, clock, options] = args;
        super(expectedElapsedTimeMs, report, logger, setIntervalFn, clearIntervalFn, setTimeoutFn, clearTimeoutFn, clock);
        this.stepMs = options?.stepMs ?? driftStepMs;
        this.baselineSize = options?.baselineSteps ?? DEFAULT_BASELINE_STEPS;
        this.maxSteps = Math.max(1, Math.floor(expectedElapsedTimeMs / this.stepMs));
        this.stepsPerWindow = this.maxSteps;
        this.windowBaseline = this.stepMs;
        this.start();
    }

    public start() : void {
        if (this.handle !== undefined) return;
        const now = this.clock.now();
        this.windowStart = now;
        this.lastStepAt = now;
        this.stepsInWindow = 0;
        this.endRow();
        this.step();
    }

    public stop() : void {
        if (this.handle === undefined) return;
        this.clearTimeoutFn(this.handle);
        this.handle = undefined;
    }

    /**
     * The idle duration of one step, from the recent steps, or the requested
     * delay before the first step.
     */
    getBaselineMs() : number {
        return this.recentSteps.length > 0 ? idleStepMs(this.recentSteps) : this.stepMs;
    }

    /**
     * The length of the last window that `measure()` ended, with its lag.
     * The window is near `expectedElapsedTimeMs` only when the baseline
     * divides it. In Firefox and WebKit on Windows, a window has 6 steps of
     * 15.6 ms (93 ms). The first window has 20 steps.
     */
    getLastWindowMs() : number {
        return this.lastWindowMs;
    }

    /** This method gives the lag of the window that ends at this time, and starts the next window. */
    measure() : number {
        const now = this.clock.now();
        const baseline = this.getBaselineMs();
        this.lastWindowMs = now - this.windowStart;
        const lag = this.lastWindowMs - this.stepsInWindow * baseline;
        this.windowStart = now;
        this.stepsInWindow = 0;
        this.windowBaseline = baseline;
        return lag;
    }

    private addStep(durationMs : number) : void {
        this.recentSteps.push(durationMs);
        if (this.recentSteps.length > this.baselineSize) this.recentSteps.shift();
        this.stepsInWindow++;
        this.followGranularity(durationMs);
    }

    /** This method finds a change of the timer granularity (refer to the class description). */
    private followGranularity(durationMs : number) : void {
        const baseline = this.windowBaseline;
        const outside = Math.abs(durationMs - baseline) > Math.max(MIN_JITTER_MS, baseline / 2);
        if (!outside || durationMs > MAX_GRANULARITY_MS) {
            this.endRow();
            return;
        }
        const min = Math.min(this.rowMin, durationMs);
        const max = Math.max(this.rowMax, durationMs);
        if (max - min <= Math.max(GRANULARITY_SPREAD_MS, GRANULARITY_SPREAD_RATIO * (min + max) / 2)) {
            this.rowCount++;
            this.rowMin = min;
            this.rowMax = max;
        } else {
            // The step does not agree with the row: a new row starts with it
            this.rowCount = 1;
            this.rowMin = durationMs;
            this.rowMax = durationMs;
        }
        if (this.rowCount < GRANULARITY_CHANGE_STEPS) return;
        // A new granularity: the baseline comes only from the steps of the row
        this.recentSteps.splice(0, this.recentSteps.length - this.rowCount);
        this.windowBaseline = idleStepMs(this.recentSteps);
        this.endRow();
    }

    private endRow() : void {
        this.rowCount = 0;
        this.rowMin = Infinity;
        this.rowMax = -Infinity;
    }

    private step() : void {
        const handle : number = this.setTimeoutFn(() => {
            const now = this.clock.now();
            this.addStep(now - this.lastStepAt);
            this.lastStepAt = now;
            // During a row that can be a new granularity, the window continues (for not more than
            // the length of a row), so that its lag uses the correct baseline
            const waitForRow = this.rowCount > 0 && this.stepsInWindow < this.stepsPerWindow + GRANULARITY_CHANGE_STEPS;
            if (this.stepsInWindow < this.stepsPerWindow || waitForRow) {
                this.step();
                return;
            }
            try {
                this.report(this.measure());
            } catch (error) {
                this.logger.log("error", "Error measuring/reporting lag.", {
                    error,
                    type : "LagMonitor",
                    subtype : "DriftLag",
                });
            }
            // A window of approximately the expected length, with the current baseline
            this.stepsPerWindow = Math.min(this.maxSteps, Math.max(1, Math.round(this.expectedElapsedTimeMs / this.windowBaseline)));
            // Continue only if report() didn't stop (or stop and restart) the monitor
            if (this.handle === handle) {
                this.step();
            }
        }, this.stepMs);
        this.handle = handle;
    }
}
