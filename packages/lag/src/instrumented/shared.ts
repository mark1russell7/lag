/**
 * Helpers shared by the instrumented factories.
 *
 * Every factory creates its instruments from the metric catalog
 * (`metric-catalog.ts`), which also states the attribute rules.
 */

import type { Logger } from "../types.js";
import type { MonitorHandle } from "../monitor-handle.js";
import type { MeasurementConditions, SampleValidator } from "../measurement-conditions.js";

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

/**
 * Returns the function that a timer-driven monitor reports through: it
 * submits each sample to a validator when `conditions` exist, and records it
 * directly when they do not. `windowMs` gives the length of the measurement
 * window that ends now.
 */
export function validatedRecorder(
    conditions : MeasurementConditions | undefined,
    record : (value : number) => void,
) : { submit : (value : number, windowMs : number) => void; dispose : () => void } {
    const validator : SampleValidator | undefined = conditions?.createValidator();
    return {
        submit : validator
            ? (value, windowMs) => validator.submit(value, windowMs, record)
            : (value) => record(value),
        dispose : () => validator?.dispose(),
    };
}
