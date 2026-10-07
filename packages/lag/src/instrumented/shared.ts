/**
 * The helpers that the instrumented factories share.
 *
 * Each factory makes its instruments from the metric catalog
 * (`metric-catalog.ts`), which also gives the attribute rules.
 */

import type { Logger } from "../types.js";
import type { MonitorHandle } from "../monitor-handle.js";
import type { MeasurementConditions, SampleValidator } from "../measurement-conditions.js";

/**
 * This function starts `build` behind an error boundary. If the construction
 * throws an error, for example because a browser API is missing, the
 * function logs a warning. Then it gives a handle with `monitor: undefined`
 * and a `stop()` that does nothing.
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
 * This function gives the recorder through which a timer-driven monitor
 * reports. With `conditions`, `submit` sends each sample to a validator.
 * Without `conditions`, `submit` records the sample directly. `windowMs`
 * gives the length of the measurement window that ends at this time.
 * `dispose` cancels the samples that wait for evidence.
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
