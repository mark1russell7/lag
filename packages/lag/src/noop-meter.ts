import type { Meter } from "./meter.js";

/**
 * A no-op Meter implementation — all `record()`/`add()` calls and gauge
 * callbacks are silent.
 *
 * Useful when:
 * - Running the lag monitors without wanting to export telemetry (e.g. in
 *   tests or environments without an OTel collector)
 * - Providing a fallback for consumers who don't pass a real Meter
 */
export function createNoopMeter() : Meter {
    return {
        createHistogram : () => ({ record() {} }),
        createCounter : () => ({ add() {} }),
        createObservableGauge : () => ({ addCallback() {}, removeCallback() {} }),
    };
}
