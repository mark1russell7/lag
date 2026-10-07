/**
 * Helpers shared by the instrumented factories.
 *
 * Attribute rule for every instrument: only low, fixed-cardinality values
 * (an event type, a pressure source). Never measured values, timestamps or
 * IDs — each distinct attribute set becomes its own time series.
 */

import type { Logger } from "../types.js";
import type { Attributes, Meter, ObservableCallback, ObservableGauge } from "../meter.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { isVisibleState, type HiddenGate, type LifecycleStateMachine } from "../LifecycleStateMachine.js";

/**
 * Runs `build` behind an error boundary: if construction throws (e.g. a
 * browser API is missing), logs a warning and returns a handle with
 * `monitor: undefined` and a no-op `stop()`.
 */
export function createHandle<T>(
    name : string,
    logger : Logger,
    build : () => { monitor : T; stop : () => void },
) : MonitorHandle<T> {
    try {
        const { monitor, stop } = build();
        return { name, monitor, stop };
    } catch (error) {
        logger.log("warn", `Failed to create the "${name}" monitor.`, { error, monitor : name });
        return { name, monitor : undefined, stop : () => {} };
    }
}

/** Registers a gauge callback; returns the function that unregisters it. */
export function observe<A extends Attributes>(gauge : ObservableGauge<A>, callback : ObservableCallback<A>) : () => void {
    gauge.addCallback(callback);
    return () => gauge.removeCallback(callback);
}

export type WindowGauges = {
    record(value : number) : void;
    dispose() : void;
};

/**
 * A max gauge and (optionally) an avg gauge over the values recorded since
 * the previous collection. A collection with no new values observes nothing.
 */
export function createWindowGauges(
    meter : Meter,
    names : { max : string; avg? : string },
    unit : string,
) : WindowGauges {
    let max : number | undefined;
    let sum = 0;
    let count = 0;

    const disposers = [
        observe(meter.createObservableGauge(names.max, { unit }), (result) => {
            if (max === undefined) return;
            result.observe(max);
            max = undefined;
        }),
    ];
    if (names.avg) {
        disposers.push(observe(meter.createObservableGauge(names.avg, { unit }), (result) => {
            if (count === 0) return;
            result.observe(sum / count);
            sum = 0;
            count = 0;
        }));
    }

    return {
        record(value) {
            if (max === undefined || value > max) max = value;
            sum += value;
            count++;
        },
        dispose() {
            for (const dispose of disposers) dispose();
        },
    };
}

/**
 * Stops `monitor` while the page is hidden or frozen and restarts it once the
 * page is visible again: hidden pages throttle timers and suspend rAF, so
 * anything measured there describes the browser's power policy, not the app.
 *
 * Pass the monitor's `gate`, if it has one, to reset it on resume: the
 * restarted monitor measures a fresh window, so its first sample is clean.
 *
 * Returns the unsubscribe function. Call it before stopping the monitor for
 * good — otherwise the next visibility change would restart it. (So stop
 * monitors through their handle, not directly.)
 */
export function pauseWhileHidden(
    lifecycle : LifecycleStateMachine,
    monitor : { start() : void; stop() : void },
    gate? : HiddenGate,
) : () => void {
    if (!isVisibleState(lifecycle.getState())) monitor.stop();
    return lifecycle.subscribe(({ from, to }) => {
        if (isVisibleState(to) && !isVisibleState(from)) {
            gate?.wasHiddenSinceLastCheck();
            monitor.start();
        } else if (!isVisibleState(to) && isVisibleState(from)) {
            monitor.stop();
        }
    });
}
