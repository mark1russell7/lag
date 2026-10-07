import type { ClearTimeoutFn, Clock, SetTimeoutFn } from "./types.js";
import { ReliabilityTracker, type UnreliableReason } from "./reliability.js";
import { isVisibleState, type LifecycleState, type LifecycleStateMachine } from "./LifecycleStateMachine.js";

/** A monitor that can stop and start again. */
export type Pausable = {
    start() : void;
    stop() : void;
};

/**
 * A very long sample is a stall. A `hang` is a stall with no evidence of a
 * suspend: the main thread was blocked. A `suspend` is a stall that overlaps
 * evidence that the whole system stopped.
 */
export type StallKind = "hang" | "suspend";

/** Why a sample was not recorded. */
export type DiscardReason = UnreliableReason;

/** Decides whether a sample is valid before a monitor records it. */
export type SampleValidator = {
    /**
     * Records `value` through `record` if the measurement window (the last
     * `windowMs` milliseconds) does not overlap an unreliable interval. A
     * value at or above the outlier threshold waits for late evidence before
     * the validator decides.
     */
    submit(value : number, windowMs : number, record : (value : number) => void) : void;
    /** Cancels the samples that wait for evidence. */
    dispose() : void;
};

/**
 * What timer-driven monitors need to know about measurement validity. The
 * instrumented factories depend on this type, not on the page lifecycle.
 */
export type MeasurementConditions = {
    readonly tracker : ReliabilityTracker;
    createValidator() : SampleValidator;
    /**
     * Stops `monitor` while the page is hidden or frozen and starts it again
     * when the page is visible. Returns the function that undoes this. Call it
     * before you stop the monitor permanently.
     */
    pauseWhileHidden(monitor : Pausable) : () => void;
    dispose() : void;
};

export type MeasurementConditionsOptions = {
    clock : Clock;
    setTimeoutFn : SetTimeoutFn;
    clearTimeoutFn : ClearTimeoutFn;
    lifecycle? : LifecycleStateMachine;
    tracker? : ReliabilityTracker;
    /** Samples at or above this value wait for late evidence. Default: 5000ms. */
    outlierThresholdMs? : number;
    /** How long an outlier waits for evidence. Default: 2000ms. */
    confirmDelayMs? : number;
    onStall? : (kind : StallKind, valueMs : number) => void;
    onDiscard? : (reason : DiscardReason) => void;
};

const DEFAULT_OUTLIER_THRESHOLD_MS = 5_000;
const DEFAULT_CONFIRM_DELAY_MS = 2_000;

function unreliableReason(state : LifecycleState) : UnreliableReason | undefined {
    if (isVisibleState(state)) return undefined;
    return state === "frozen" ? "frozen" : "hidden";
}

/**
 * Builds the measurement conditions for a set of monitors. With a
 * `lifecycle`, hidden and frozen periods become unreliable intervals, and
 * `pauseWhileHidden` stops monitors during them.
 */
export function createMeasurementConditions(options : MeasurementConditionsOptions) : MeasurementConditions {
    const { clock, setTimeoutFn, clearTimeoutFn, lifecycle } = options;
    const tracker = options.tracker ?? new ReliabilityTracker(clock);
    const outlierThresholdMs = options.outlierThresholdMs ?? DEFAULT_OUTLIER_THRESHOLD_MS;
    const confirmDelayMs = options.confirmDelayMs ?? DEFAULT_CONFIRM_DELAY_MS;
    const disposers : Array<() => void> = [];

    if (lifecycle) {
        let closeInterval : (() => void) | undefined;
        const follow = (state : LifecycleState) : void => {
            const reason = unreliableReason(state);
            closeInterval?.();
            closeInterval = reason ? tracker.open(reason) : undefined;
        };
        follow(lifecycle.getState());
        disposers.push(lifecycle.subscribe(({ to }) => follow(to)));
        disposers.push(() => closeInterval?.());
    }

    const createValidator = () : SampleValidator => {
        const pending = new Set<number>();
        return {
            submit(value, windowMs, record) {
                // visibilityState changes before visibilitychange fires; this read syncs the lifecycle
                lifecycle?.getState();
                const end = clock.now();
                const start = end - windowMs;
                const overlap = tracker.findOverlap(start, end);
                if (overlap) {
                    options.onDiscard?.(overlap.reason);
                    return;
                }
                if (value < outlierThresholdMs) {
                    record(value);
                    return;
                }
                // Evidence of a suspend (from the worker) can arrive after the sample
                const handle : number = setTimeoutFn(() => {
                    pending.delete(handle);
                    const late = tracker.findOverlap(start, end);
                    if (late) {
                        options.onDiscard?.(late.reason);
                        if (late.reason === "suspend") options.onStall?.("suspend", value);
                        return;
                    }
                    options.onStall?.("hang", value);
                    record(value);
                }, confirmDelayMs);
                pending.add(handle);
            },
            dispose() {
                for (const handle of pending) clearTimeoutFn(handle);
                pending.clear();
            },
        };
    };

    const pauseWhileHidden = (monitor : Pausable) : () => void => {
        if (!lifecycle) return () => {};
        if (!isVisibleState(lifecycle.getState())) monitor.stop();
        return lifecycle.subscribe(({ from, to }) => {
            if (isVisibleState(to) && !isVisibleState(from)) monitor.start();
            else if (!isVisibleState(to) && isVisibleState(from)) monitor.stop();
        });
    };

    return {
        tracker,
        createValidator,
        pauseWhileHidden,
        dispose() {
            for (const dispose of disposers) dispose();
            disposers.length = 0;
        },
    };
}
