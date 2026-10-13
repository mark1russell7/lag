/**
 * A simplified model of DriftLag for the stepper of the documentation. It
 * makes the timer steps of some windows, with one block of the main thread.
 * Then it calculates the lag of each window in the same way as the monitor.
 * The lag is the duration of the window minus the number of steps multiplied
 * by the baseline.
 *
 * The model has no warm-up, no granularity change and no probes. The
 * monitor has them (refer to `DriftLag.ts`).
 */

export type DriftScenario = {
    /** The idle duration of one timer step on this browser and system, in ms (the timer granularity). */
    granularityMs : number;
    /** The requested delay of each step. DriftLag requests 5 ms. */
    stepMs : number;
    /** The expected duration of a window. DriftLag uses 100 ms. */
    windowMs : number;
    windows : number;
    /** One block of the main thread, in ms from the start of the first window. */
    block : { readonly start : number; readonly duration : number } | undefined;
    /** True: the monitor subtracts the calibrated baseline. False: it subtracts the requested delay. */
    calibrated : boolean;
    /** The largest difference of an idle step from the granularity, in ms. */
    jitterMs : number;
};

export type DriftStep = {
    /** The time at which the step requested its timer. */
    start : number;
    /** The time at which the timer callback started. */
    end : number;
    /** True if the block delayed the callback. */
    delayed : boolean;
};

export type DriftWindow = {
    index : number;
    start : number;
    end : number;
    steps : number;
    /** The idle duration of the steps: the number of steps multiplied by the baseline. */
    idleMs : number;
    /** The lag of the window: its duration minus its idle duration. */
    lagMs : number;
    /** The part of the block that is in the window. */
    blockedMs : number;
};

export type DriftResult = {
    /** The idle duration of one step that the monitor subtracts. */
    baselineMs : number;
    stepsPerWindow : number;
    steps : readonly DriftStep[];
    windows : readonly DriftWindow[];
    /** The end of the last window. */
    end : number;
};

/** The number of recent steps that give the baseline of DriftLag. */
const BASELINE_STEPS = 100;

/** A jitter from −1 to 1 for each step number. The same number always gives the same jitter, thus the model has no random values. */
export function jitterOf(step : number) : number {
    const value = Math.sin((step + 1) * 12.9898) * 43_758.5453;
    return (value - Math.floor(value)) * 2 - 1;
}

/** The idle duration of step `step`, without a block. */
function idleStepMs(scenario : DriftScenario, step : number) : number {
    return scenario.granularityMs + scenario.jitterMs * jitterOf(step);
}

/** The baseline: the mean of the idle durations of the recent steps, or the requested delay without calibration. */
export function baselineOf(scenario : DriftScenario) : number {
    if (!scenario.calibrated) return scenario.stepMs;
    let sum = 0;
    for (let step = 0; step < BASELINE_STEPS; step++) sum += idleStepMs(scenario, step);
    return sum / BASELINE_STEPS;
}

function overlap(start : number, end : number, block : DriftScenario["block"]) : number {
    if (!block) return 0;
    return Math.max(0, Math.min(end, block.start + block.duration) - Math.max(start, block.start));
}

/**
 * This function makes the steps and the windows of a scenario. A timer
 * callback cannot start during the block. Thus a step whose timer comes
 * during the block ends at the end of the block.
 */
export function simulateDrift(scenario : DriftScenario) : DriftResult {
    const baselineMs = baselineOf(scenario);
    // The number of steps changes with the baseline, so that a window stays near its expected duration.
    // It is from 1 to the number of requested delays in a window (20).
    const maxSteps = Math.max(1, Math.floor(scenario.windowMs / scenario.stepMs));
    const stepsPerWindow = Math.min(maxSteps, Math.max(1, Math.round(scenario.windowMs / baselineMs)));
    const blockEnd = scenario.block ? scenario.block.start + scenario.block.duration : 0;
    const steps : DriftStep[] = [];
    const windows : DriftWindow[] = [];
    let time = 0;
    for (let index = 0; index < scenario.windows; index++) {
        const windowStart = time;
        for (let step = 0; step < stepsPerWindow; step++) {
            const due = time + idleStepMs(scenario, steps.length);
            const delayed = scenario.block !== undefined && scenario.block.duration > 0 && due > scenario.block.start && due < blockEnd;
            const end = delayed ? blockEnd : due;
            steps.push({ start : time, end, delayed });
            time = end;
        }
        const idleMs = stepsPerWindow * baselineMs;
        windows.push({
            index,
            start : windowStart,
            end : time,
            steps : stepsPerWindow,
            idleMs,
            lagMs : time - windowStart - idleMs,
            blockedMs : overlap(windowStart, time, scenario.block),
        });
    }
    return { baselineMs, stepsPerWindow, steps, windows, end : time };
}
