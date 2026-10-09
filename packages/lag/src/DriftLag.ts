import { BaselineConfirmation } from "./BaselineConfirmation.js";
import { BusyTimeProbe } from "./BusyTimeProbe.js";
import { driftStepMs } from "./constants.js";
import { MIN_JITTER_MS, idleStepMs, isIdleStep, outsideStepMs, spreadMs, stepsUpTo, usedBaselineMs } from "./drift-baseline.js";
import { LagMonitor } from "./LagMonitor.js";
import type { PostTaskFn } from "./message-task.js";

export type DriftLagOptions = {
    /** The requested delay of each timer step. The default is `driftStepMs` (5 ms). */
    stepMs? : number;
    /** The number of recent steps that give the baseline. The default is 100. */
    baselineSteps? : number;
    /**
     * A function that starts a callback in a new task, for example
     * `createMessageTaskQueue(...).post`. With it, the monitor accepts a
     * longer baseline only after a probe shows an idle thread (refer to the
     * class description). Without it, a sustained load can increase the
     * baseline.
     */
    postTask? : PostTaskFn;
};

const DEFAULT_BASELINE_STEPS = 100;

/**
 * The monitor accepts a new timer granularity after this number of steps in
 * a row that agree with each other, but not with the baseline.
 */
const GRANULARITY_CHANGE_STEPS = 10;

/**
 * The longest step that a timer granularity gives, with a margin. Examples
 * are two ticks of the Windows timer (31.25 ms) and the 30 ms grid of WebKit
 * in Low Power Mode. A row of longer steps is lag, not a granularity.
 */
const MAX_GRANULARITY_MS = 40;

/** A row of longer steps starts a probe after this number of steps. */
const PROBE_ROW_STEPS = 5;

/**
 * The steps after `start()` that are a warm-up. WebKit aligns a timer only
 * from the nesting level 10 (`DOMTimer.cpp`). A chain that starts outside a
 * timer task has the level 0, thus its first 10 steps are not aligned. They
 * are shorter than the aligned steps. The 11th step starts at a time that is
 * not aligned, thus its duration is between 5 ms and 35 ms on the grid of
 * 30 ms.
 */
const WARM_UP_STEPS = 11;

/** The probe of a monitor with `postTask`, and the confirmed idle duration of one step. */
type Probing = {
    readonly probe : BusyTimeProbe;
    readonly confirmation : BaselineConfirmation;
    /** True when the next step starts a probe. */
    wanted : boolean;
    /** True when the last step was probed. */
    afterProbe : boolean;
};

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
 * baseline.
 *
 * WebKit aligns only the timers of the nesting level 10 or more. `start()`
 * starts a new chain at a low level, for example in a `visibilitychange`
 * task. Thus, the first 11 steps after `start()` are a warm-up. A warm-up
 * step that is shorter than the baseline is not a step of the window. It is
 * not a recent step, it is not in a row, and it gives no lag.
 *
 * A longer warm-up step is a usual step, because the granularity can change
 * while the monitor is stopped. For example, the steps of Chromium on
 * Windows changed from 5.5 ms to 15.6 ms after the page was hidden and shown
 * again. At the first start, the baseline is the requested delay, and no
 * step is shorter.
 *
 * The timer granularity can change while the monitor operates. For example,
 * Windows can change the timer resolution of the browser process on battery
 * power, or when a window is hidden and shown again. Then all steps change
 * by the same quantity, also on an idle thread. A block makes one step long,
 * and the next steps are normal again. Thus, a row of 10 steps that agree
 * with each other, but not with the baseline, starts a new baseline.
 *
 * A window that ends during such a row continues until the row ends, or
 * until the monitor accepts the new granularity. The steps of the window
 * before the row keep the old baseline, and the other steps get the new
 * baseline. Thus, the change gives no lag. Steps of more than 40 ms are not
 * a granularity.
 *
 * A step before the row that is outside the old baseline can have the new
 * granularity. It can also be the step in which the granularity changed, or
 * a block. Its value is between the two baselines (`outsideStepMs`). Thus no
 * step before the row gives false lag.
 *
 * A sustained load can also make the steps longer. Tasks of the same length
 * give a row of equal steps. If the thread is busy during more than half of
 * the steps, the median is a busy step. In the two cases, the baseline
 * increases.
 *
 * Thus, with `postTask`, the monitor accepts a longer baseline only after a
 * `BusyTimeProbe` shows an idle thread during one step. A probe keeps the
 * thread awake, thus a probed step can be shorter than an idle step, and the
 * next step can be longer. Thus, these two steps are not recent steps, and
 * they are not in a row. The rules are in `BaselineConfirmation` and
 * `drift-baseline.ts`:
 *
 * - A check is an idle probe, 3 steps, and a second idle probe. The 3 steps
 *   must agree with each other. Their mean is an idle duration of one step.
 * - After the first window, a check confirms the recent baseline as the
 *   first value.
 * - At the end of a window, an increase of more than max(1 ms, 10%) above
 *   the confirmed value starts a check. Until a check confirms the
 *   increase, the monitor uses the confirmed value.
 * - Steps of a check that agree with the confirmed value show that the
 *   longer recent steps were load. The monitor removes them from the recent
 *   steps.
 * - After the first confirmed value, a row of 5 longer steps starts a probe
 *   of the next step. A row of longer steps is a granularity only if the
 *   last probe during the row showed an idle thread. A window does not wait
 *   for a busy row.
 *
 * A shorter baseline needs no probe, because a busy thread does not make a
 * step shorter. The confirmed value decreases to the highest recent
 * baseline of the last 3 windows. Before the first confirmed value, and
 * without `postTask`, the monitor accepts a longer baseline without a probe.
 * Then a sustained load increases the baseline, and the monitor reports less
 * lag. The worker monitor measures that case correctly.
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
    // The steps in a row that agree with each other, but not with `windowBaseline`. start() sets them.
    private rowCount! : number;
    private rowMin! : number;
    private rowMax! : number;
    /** The result of the last probe during the row. */
    private rowProbe : "idle" | "busy" | undefined;
    /** The step of the window at which the row started, from 0. The value -1 is a row of an earlier window. */
    private rowStart = -1;
    /**
     * The durations of the steps of the window that were outside the
     * baseline, after the early steps. The last steps are the steps of the row.
     */
    private readonly outsideSteps : number[] = [];
    /**
     * The steps of the window before an accepted row. They do not get the
     * baseline of the end of the window.
     */
    private earlySteps = 0;
    /** The idle duration of the steps before an accepted row, at the old baseline. */
    private preRowIdleMs = 0;
    /** The time of the warm-up steps of the window that were shorter than the baseline. */
    private shortWarmUpMs = 0;
    /** The number of warm-up steps that did not end. */
    private warmUpLeft = 0;
    /** The probed steps and the steps after a probe in the window. They are not in a row. */
    private skippedSteps = 0;
    private readonly probing : Probing | undefined;
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
        this.probing = options?.postTask
            ? { probe : new BusyTimeProbe(options.postTask, clock), confirmation : new BaselineConfirmation(), wanted : false, afterProbe : false }
            : undefined;
        this.start();
    }

    public start() : void {
        if (this.handle !== undefined) return;
        const now = this.clock.now();
        this.lastStepAt = now;
        this.startWindow(now);
        this.warmUpLeft = WARM_UP_STEPS;
        this.endRow();
        this.step();
    }

    public stop() : void {
        if (this.handle === undefined) return;
        this.clearTimeoutFn(this.handle);
        this.handle = undefined;
        this.probing?.probe.stop();
    }

    /**
     * The idle duration of one step, from the recent steps, or the requested
     * delay before the first step. With a probe, an increase of more than
     * max(1 ms, 10%) above the confirmed value waits for a probe. Until
     * then, the value is the confirmed value.
     */
    getBaselineMs() : number {
        return usedBaselineMs(this.recentBaselineMs(), this.probing?.confirmation.confirmedMs);
    }

    /**
     * The length of the last window that `measure()` ended, with its lag.
     * The window is near `expectedElapsedTimeMs` only when the baseline
     * divides it. In Firefox and WebKit on Windows, a window has 6 steps of
     * 15.6 ms (93 ms). The first window has 20 steps. With steps of 15.6 ms,
     * it has 21 steps, because it waits for the row of these steps after the
     * warm-up.
     */
    getLastWindowMs() : number {
        return this.lastWindowMs;
    }

    /**
     * This method gives the lag of the window that ends at this time, and
     * starts the next window. Each step of the window gets the baseline,
     * except the steps before an accepted row. They get the old baseline. A
     * short warm-up step is not a step of the window.
     */
    measure() : number {
        const now = this.clock.now();
        let baseline = this.recentBaselineMs();
        if (this.probing) {
            const window = this.probing.confirmation.endWindow(baseline);
            baseline = window.baselineMs;
            if (window.probe) this.probing.wanted = true;
        }
        this.lastWindowMs = now - this.windowStart;
        const idleMs = this.shortWarmUpMs + this.preRowIdleMs + (this.stepsInWindow - this.earlySteps) * baseline;
        this.startWindow(now);
        this.windowBaseline = baseline;
        return this.lastWindowMs - idleMs;
    }

    private startWindow(now : number) : void {
        this.windowStart = now;
        this.stepsInWindow = 0;
        this.earlySteps = 0;
        this.preRowIdleMs = 0;
        this.shortWarmUpMs = 0;
        this.outsideSteps.length = 0;
        this.skippedSteps = 0;
        this.rowStart = -1;
    }

    private recentBaselineMs() : number {
        return this.recentSteps.length > 0 ? idleStepMs(this.recentSteps) : this.stepMs;
    }

    /** This method adds a step that was not probed. */
    private addStep(durationMs : number) : void {
        this.recentSteps.push(durationMs);
        if (this.recentSteps.length > this.baselineSize) this.recentSteps.shift();
        this.followGranularity(durationMs);
        if (this.probing?.confirmation.addStep(durationMs)) this.probing.wanted = true;
    }

    /**
     * This method uses the result of a probe. The duration of a probed step
     * is not an idle duration. The result applies to the row of steps, if a
     * row operates. A new row starts without a result.
     */
    private addProbedStep(durationMs : number, busyMs : number, probing : Probing) : void {
        const idle = isIdleStep(durationMs, this.windowBaseline, busyMs);
        if (this.rowCount > 0) this.rowProbe = idle ? "idle" : "busy";
        const loadAboveMs = probing.confirmation.addProbe(idle, this.recentBaselineMs());
        if (loadAboveMs !== undefined) this.recentSteps.splice(0, this.recentSteps.length, ...stepsUpTo(this.recentSteps, loadAboveMs));
    }

    /** This method finds a change of the timer granularity (refer to the class description). */
    private followGranularity(durationMs : number) : void {
        const baseline = this.windowBaseline;
        const outside = Math.abs(durationMs - baseline) > Math.max(MIN_JITTER_MS, baseline / 2);
        if (outside) this.outsideSteps.push(durationMs);
        if (!outside || durationMs > MAX_GRANULARITY_MS) {
            this.endRow();
            return;
        }
        const min = Math.min(this.rowMin, durationMs);
        const max = Math.max(this.rowMax, durationMs);
        if (max - min <= spreadMs((min + max) / 2)) {
            this.rowCount++;
            this.rowMin = min;
            this.rowMax = max;
        } else {
            // The step does not agree with the row: a new row starts with it
            this.startRow(durationMs);
        }
        if (this.rowCount === 1) this.rowStart = this.stepsInWindow;
        // Equal tasks on a busy thread also give a row of longer steps. Thus, after the first confirmed
        // value, a row of longer steps is a granularity only if the last probe during the row was idle.
        const probing = this.probing;
        const needsProbe = probing !== undefined && probing.confirmation.confirmedMs !== undefined && durationMs > baseline;
        if (needsProbe && this.rowCount === PROBE_ROW_STEPS) probing.wanted = true;
        if (this.rowCount >= GRANULARITY_CHANGE_STEPS && (!needsProbe || this.rowProbe === "idle")) this.acceptRow();
    }

    /**
     * A new granularity: the baseline comes only from the steps of the row.
     * The steps of the window before the row operated at the old granularity,
     * thus they keep the old baseline. A step before the row that was outside
     * the old baseline gets a value between the two baselines
     * (`outsideStepMs`).
     */
    private acceptRow() : void {
        const oldMs = this.windowBaseline;
        this.recentSteps.splice(0, this.recentSteps.length - this.rowCount);
        this.windowBaseline = idleStepMs(this.recentSteps);
        this.probing?.confirmation.accept(this.windowBaseline);
        if (this.rowStart > this.earlySteps) {
            const outsideBefore = this.outsideSteps.slice(0, this.outsideSteps.length - this.rowCount);
            this.preRowIdleMs += (this.rowStart - this.earlySteps - outsideBefore.length) * oldMs;
            for (const durationMs of outsideBefore) this.preRowIdleMs += outsideStepMs(durationMs, oldMs, this.windowBaseline);
            this.earlySteps = this.rowStart;
        }
        this.outsideSteps.length = 0;
        this.endRow();
    }

    private startRow(durationMs : number) : void {
        this.rowCount = 1;
        this.rowMin = durationMs;
        this.rowMax = durationMs;
        this.rowProbe = undefined;
    }

    private endRow() : void {
        this.rowCount = 0;
        this.rowMin = Infinity;
        this.rowMax = -Infinity;
        this.rowProbe = undefined;
    }

    private step() : void {
        const handle : number = this.setTimeoutFn(() => {
            const now = this.clock.now();
            const durationMs = now - this.lastStepAt;
            const warmUp = this.warmUpLeft > 0;
            if (warmUp) this.warmUpLeft--;
            // A probe that operated during this step gives the busy time of the thread. A probe also
            // changes the next step: in Chromium, the thread woke 3 ms later after a probe. A short
            // warm-up step is not a step of the window (refer to the class description).
            if (this.probing?.probe.isRunning()) {
                this.addProbedStep(durationMs, this.probing.probe.stop(), this.probing);
                this.probing.afterProbe = true;
                this.skippedSteps++;
            } else if (this.probing?.afterProbe) {
                this.probing.afterProbe = false;
                this.skippedSteps++;
            } else if (warmUp && durationMs < this.windowBaseline) {
                this.shortWarmUpMs += durationMs;
                this.lastStepAt = now;
                this.step();
                return;
            } else {
                this.addStep(durationMs);
            }
            this.stepsInWindow++;
            this.lastStepAt = now;
            // During a row that can be a new granularity, the window continues (for not more than
            // the length of a row), so that its lag uses the correct baseline. The skipped steps are not in the row.
            const waitForRow = this.rowCount > 0 && this.rowProbe !== "busy"
                && this.stepsInWindow - this.skippedSteps < this.stepsPerWindow + GRANULARITY_CHANGE_STEPS;
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
        if (this.probing?.wanted) {
            this.probing.wanted = false;
            this.probing.probe.start();
        }
    }
}
