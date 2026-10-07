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
 */
export class DriftLag extends LagMonitor {
    private handle : number | undefined;
    private windowStart = 0;
    private lastStepAt = 0;
    private stepsInWindow = 0;
    private stepsPerWindow : number;
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
        this.start();
    }

    public start() : void {
        if (this.handle !== undefined) return;
        const now = this.clock.now();
        this.windowStart = now;
        this.lastStepAt = now;
        this.stepsInWindow = 0;
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

    /** This method gives the lag of the window that ends at this time, and starts the next window. */
    measure() : number {
        const now = this.clock.now();
        const lag = now - this.windowStart - this.stepsInWindow * this.getBaselineMs();
        this.windowStart = now;
        this.stepsInWindow = 0;
        return lag;
    }

    private addStep(durationMs : number) : void {
        this.recentSteps.push(durationMs);
        if (this.recentSteps.length > this.baselineSize) this.recentSteps.shift();
        this.stepsInWindow++;
    }

    private step() : void {
        const handle : number = this.setTimeoutFn(() => {
            const now = this.clock.now();
            this.addStep(now - this.lastStepAt);
            this.lastStepAt = now;
            if (this.stepsInWindow < this.stepsPerWindow) {
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
            this.stepsPerWindow = Math.min(this.maxSteps, Math.max(1, Math.round(this.expectedElapsedTimeMs / this.getBaselineMs())));
            // Continue only if report() didn't stop (or stop and restart) the monitor
            if (this.handle === handle) {
                this.step();
            }
        }, this.stepMs);
        this.handle = handle;
    }
}
