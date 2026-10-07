import type { Meter } from "./meter.js";

/**
 * A Meter that records nothing.
 *
 * Use it to run the monitors without telemetry export, for example in tests
 * or where no OTel collector is available.
 */
export function createNoopMeter() : Meter {
    return {
        createHistogram : () => ({ record() {} }),
        createCounter : () => ({ add() {} }),
    };
}
