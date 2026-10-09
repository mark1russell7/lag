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

/** The reason why a monitor did not record a sample. */
export type DiscardReason = UnreliableReason;

/** The validator decides if a sample is valid, before a monitor records it. */
export type SampleValidator = {
    /**
     * This method records `value` through `record` if the measurement window
     * (the last `windowMs` milliseconds) does not overlap an unreliable
     * interval. A value at or above the outlier threshold waits for late
     * evidence before the validator decides.
     */
    submit(value : number, windowMs : number, record : (value : number) => void) : void;
    /** This method cancels the samples that wait for evidence. */
    dispose() : void;
};

/**
 * The information about measurement validity that the timer-driven monitors
 * use. The instrumented factories depend on this type, not on the page
 * lifecycle.
 */
export type MeasurementConditions = {
    readonly tracker : ReliabilityTracker;
    createValidator() : SampleValidator;
    /**
     * This method stops `monitor` while the page is hidden or frozen, and
     * starts it again when the page is visible. It gives the function that
     * cancels this behavior. Use that function before you stop the monitor
     * permanently.
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
    /** Samples at or above this value wait for late evidence. The default is 5000 ms. */
    outlierThresholdMs? : number;
    /** The time that an outlier waits for evidence. The default is 2000 ms. */
    confirmDelayMs? : number;
    /**
     * The function gets one call for each stall episode: the stall samples of
     * all validators whose windows overlap. `valueMs` is the longest sample of
     * the episode. The kind is `suspend` if a sample of the episode had
     * evidence of a suspend. `startTime` is the start of the first window of
     * the episode, in the time of `clock`.
     */
    onStall? : (kind : StallKind, valueMs : number, startTime : number) => void;
    onDiscard? : (reason : DiscardReason) => void;
};

const DEFAULT_OUTLIER_THRESHOLD_MS = 5_000;
const DEFAULT_CONFIRM_DELAY_MS = 2_000;

/**
 * One block of the main thread gives a stall sample in each validated
 * monitor, and in each worker heartbeat that waited. The samples of one
 * episode arrive soon after the block ends. Thus an episode waits this long
 * for more samples before the conditions report it.
 */
const EPISODE_SETTLE_MS = 2_000;

type StallEpisode = {
    start : number;
    end : number;
    kind : StallKind;
    valueMs : number;
    handle : number;
};

function unreliableReason(state : LifecycleState) : UnreliableReason | undefined {
    if (isVisibleState(state)) return undefined;
    return state === "frozen" ? "frozen" : "hidden";
}

/**
 * This function makes the measurement conditions for a set of monitors. With
 * a `lifecycle`, the hidden and frozen periods become unreliable intervals,
 * and `pauseWhileHidden` stops the monitors during them.
 */
export function createMeasurementConditions(options : MeasurementConditionsOptions) : MeasurementConditions {
    const { clock, setTimeoutFn, clearTimeoutFn, lifecycle } = options;
    const tracker = options.tracker ?? new ReliabilityTracker(clock);
    const outlierThresholdMs = options.outlierThresholdMs ?? DEFAULT_OUTLIER_THRESHOLD_MS;
    const confirmDelayMs = options.confirmDelayMs ?? DEFAULT_CONFIRM_DELAY_MS;
    const disposers : Array<() => void> = [];
    const episodes : StallEpisode[] = [];

    const reportEpisode = (episode : StallEpisode) : void => {
        const index = episodes.indexOf(episode);
        if (index >= 0) episodes.splice(index, 1);
        options.onStall?.(episode.kind, episode.valueMs, episode.start);
    };

    /** This function adds a stall sample to the episode that its window overlaps, or it starts a new episode. */
    const addStall = (kind : StallKind, valueMs : number, start : number, end : number) : void => {
        const episode = episodes.find(candidate => start <= candidate.end && end >= candidate.start);
        if (episode) {
            episode.start = Math.min(episode.start, start);
            episode.end = Math.max(episode.end, end);
            episode.valueMs = Math.max(episode.valueMs, valueMs);
            if (kind === "suspend") episode.kind = "suspend";
            return;
        }
        const created : StallEpisode = { start, end, kind, valueMs, handle : 0 };
        created.handle = setTimeoutFn(() => reportEpisode(created), EPISODE_SETTLE_MS);
        episodes.push(created);
    };

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

    /** The interval that overlaps a window. A suspend comes first, because it decides the kind of a stall. */
    const findOverlap = (start : number, end : number) =>
        tracker.findOverlap(start, end, "suspend") ?? tracker.findOverlap(start, end);

    /**
     * This function discards a sample whose window overlaps an unreliable
     * interval. A very long sample during a suspend is also a stall. The
     * evidence can come before the sample or after it: the result is the same.
     */
    const discard = (overlap : { reason : DiscardReason }, value : number, start : number, end : number) : void => {
        options.onDiscard?.(overlap.reason);
        if (overlap.reason === "suspend" && value >= outlierThresholdMs) addStall("suspend", value, start, end);
    };

    const createValidator = () : SampleValidator => {
        const pending = new Set<number>();
        return {
            submit(value, windowMs, record) {
                // visibilityState changes before visibilitychange fires; this read syncs the lifecycle
                lifecycle?.getState();
                const end = clock.now();
                const start = end - windowMs;
                const overlap = findOverlap(start, end);
                if (overlap) {
                    discard(overlap, value, start, end);
                    return;
                }
                if (value < outlierThresholdMs) {
                    record(value);
                    return;
                }
                // Evidence of a suspend (from the worker) can arrive after the sample
                const handle : number = setTimeoutFn(() => {
                    pending.delete(handle);
                    const late = findOverlap(start, end);
                    if (late) {
                        discard(late, value, start, end);
                        return;
                    }
                    addStall("hang", value, start, end);
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
            // Report the episodes that wait, because no later report can come
            for (const episode of [...episodes]) {
                clearTimeoutFn(episode.handle);
                reportEpisode(episode);
            }
        },
    };
}
