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

    it("with MessageChannel, does not count a busy main thread as throttling, and closes the channel at stop()", async () => {
        const meter = createRecordingMeter();
        const channels : FakeMessageChannel[] = [];
        class FakeMessageChannel {
            readonly port1 = { postMessage : vi.fn(), onmessage : null as (() => void) | null, close : vi.fn() };
            readonly port2 = { postMessage : () => { setTimeout(() => this.port1.onmessage?.(), blockMs); }, onmessage : null, close : vi.fn() };
            constructor() { channels.push(this); }
        }
        // Each task of the main thread waits 200 ms: the timer and the message task
        const blockMs = 200;
        const handle = createInstrumentedThrottleDetector({
            logger : { log : vi.fn() },
            clock : { now : () => Date.now() },
            meter : meter.meter,
            setTimeoutFn : (fn, ms) => setTimeout(fn, ms === 5 ? blockMs : ms) as unknown as number,
            clearTimeoutFn : (id) => clearTimeout(id),
            MessageChannel : FakeMessageChannel,
            throttleConfig : { calibrationTargetMs : 5, throttleThresholdMs : 100, calibrationSamples : 1, calibrationIntervalMs : 1_000 },
        });

        await vi.advanceTimersByTimeAsync(blockMs);
        handle.stop();

        expect(meter.records().get("lag_timer_calibrations")).toEqual([{ value : 1, attributes : { throttled : "false" } }]);
        expect(channels).toHaveLength(1);
        expect(channels[0]!.port1.close).toHaveBeenCalledTimes(1);
        expect(channels[0]!.port2.close).toHaveBeenCalledTimes(1);
    });
});
