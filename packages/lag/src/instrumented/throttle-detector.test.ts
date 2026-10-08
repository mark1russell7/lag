import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstrumentedThrottleDetector } from "./throttle-detector.js";
import { createRecordingMeter, expectCatalogInstruments } from "../test-utils.js";

describe("createInstrumentedThrottleDetector", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("counts each calibration round with the attribute throttled", () => {
        let delayMs = 0;
        const meter = createRecordingMeter();
        const handle = createInstrumentedThrottleDetector({
            logger : { log : vi.fn() },
            clock : { now : () => Date.now() },
            meter : meter.meter,
            setTimeoutFn : (fn, ms) => setTimeout(fn, ms + delayMs) as unknown as number,
            clearTimeoutFn : (id) => clearTimeout(id),
            throttleConfig : { calibrationTargetMs : 5, throttleThresholdMs : 100, calibrationSamples : 1, calibrationIntervalMs : 1_000 },
        });

        // In a normal round, the sample takes 5 ms
        vi.advanceTimersByTime(5);
        // In a throttled round, the browser delays the next timers by 1 s
        delayMs = 1_000;
        vi.advanceTimersByTime(3_000);
        handle.stop();

        expect(meter.records().get("lag_timer_calibrations")!.slice(0, 2)).toEqual([
            { value : 1, attributes : { throttled : "false" } },
            { value : 1, attributes : { throttled : "true" } },
        ]);
        expectCatalogInstruments(meter);
    });
});
