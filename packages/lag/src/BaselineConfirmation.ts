import { interpretCheck, usedBaselineMs } from "./drift-baseline.js";

/** The number of steps between two idle probes that confirm an idle duration. */
const CHECK_STEPS = 3;

/** The confirmed value decreases to the highest recent baseline of this number of windows. */
const DECREASE_WINDOWS = 3;

/**
 * The confirmed idle duration of one DriftLag step (refer to `DriftLag`).
 *
 * A probe shows if the thread was idle during one step. A probe keeps the
 * thread awake, thus a probed step can be shorter than an idle step. Thus the
 * idle duration comes only from steps that were not probed: the 3 steps
 * between two idle probes. This sequence is a check.
 *
 * A check is necessary before the first confirmed value, and while the
 * recent baseline is more than max(1 ms, 10%) above the confirmed value.
 * Then each window starts a check, until a check confirms a value. A probe
 * on a busy thread posts few messages, thus a check costs little during a
 * load.
 */
export class BaselineConfirmation {
    private value : number | undefined;
    /** True when the last window needed a check. */
    private needed = true;
    /** The steps after the idle probe that started a check. */
    private checkSteps : number[] | undefined;
    /** The recent baselines at the end of the last windows, oldest first. */
    private readonly lastRecents : number[] = [];

    /** The confirmed idle duration of one step. Before the first confirmation, there is no value. */
    get confirmedMs() : number | undefined {
        return this.value;
    }

    /**
     * This method sets a new granularity that a row of steps showed, and it
     * ends a check. Without a confirmed value, only a check can confirm the
     * first value. Then a row of longer steps needs no probe, thus it does
     * not show an idle thread.
     */
    accept(idleMs : number) : void {
        if (this.value !== undefined) this.value = idleMs;
        this.checkSteps = undefined;
    }

    /**
     * At the end of a window, this method gives the baseline of the window,
     * and true if the next step starts a check. A busy thread does not make
     * steps shorter, thus a lower recent baseline also lowers the confirmed
     * value. The value decreases only to the highest recent baseline of the
     * last 3 windows. Thus a short decrease does not change it: in Firefox,
     * irregular steps after a load decreased the recent baseline for one
     * window.
     */
    endWindow(recentMs : number) : { baselineMs : number; probe : boolean } {
        this.lastRecents.push(recentMs);
        if (this.lastRecents.length > DECREASE_WINDOWS) this.lastRecents.shift();
        if (this.value !== undefined) this.value = Math.min(this.value, Math.max(...this.lastRecents));
        const baselineMs = usedBaselineMs(recentMs, this.value);
        this.needed = this.value === undefined || baselineMs !== recentMs;
        return { baselineMs, probe : this.needed && this.checkSteps === undefined };
    }

    /** This method adds a step that was not probed. It gives true if the next step closes a check. */
    addStep(durationMs : number) : boolean {
        if (this.checkSteps === undefined) return false;
        this.checkSteps.push(durationMs);
        return this.checkSteps.length === CHECK_STEPS;
    }

    /**
     * This method adds the result of a probe. An idle probe that closes a
     * check can set a new confirmed value (refer to `interpretCheck`). Or, it
     * gives the limit above which the recent steps are load. Another idle
     * probe starts a check, if a check is necessary. A probe of a row of
     * steps can also start a check.
     */
    addProbe(idle : boolean, recentMs : number) : number | undefined {
        const check = this.checkSteps;
        this.checkSteps = undefined;
        if (check?.length === CHECK_STEPS) {
            const finding = idle ? interpretCheck(check, recentMs, this.value) : undefined;
            if (finding && "loadAboveMs" in finding) return finding.loadAboveMs;
            if (finding) this.value = finding.confirmedMs;
            return undefined;
        }
        if (idle && this.needed) this.checkSteps = [];
        return undefined;
    }
}
