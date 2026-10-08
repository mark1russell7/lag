import type { Meter } from "./meter.js";

/**
 * A `Meter` that records nothing.
 *
 * Use it when the monitors must not export telemetry, for example in tests
 * or when no OTel collector is available.
 */
export function createNoopMeter() : Meter {
    return {
        createHistogram : () => ({ record() {} }),
        createCounter : () => ({ add() {} }),
    };
}
