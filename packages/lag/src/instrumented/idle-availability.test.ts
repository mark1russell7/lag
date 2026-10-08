import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstrumentedIdleAvailability } from "./idle-availability.js";
import { createMeasurementConditions } from "../measurement-conditions.js";
import { createFakeLifecycle } from "../vitals/test-fakes.js";
import { createRecordingMeter, expectCatalogInstruments } from "../test-utils.js";
import type { IdleDeadline } from "../IdleAvailabilityMonitor.js";

/** Idle callbacks on demand, on the clock of a fake lifecycle. `idle(time, deadline)` starts the callbacks that wait. */
function setup(withConditions : boolean) {
    const fake = createFakeLifecycle();
    const waiting = new Map<number, (deadline : IdleDeadline) => void>();
    let nextHandle = 1;
    const meter = createRecordingMeter();
    const conditions = withConditions
        ? createMeasurementConditions({
            clock : fake.clock,
            setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
            clearTimeoutFn : (id) => clearTimeout(id),
            lifecycle : fake.lifecycle,
        })
        : undefined;
    const handle = createInstrumentedIdleAvailability({
        logger : { log : vi.fn() },
        clock : fake.clock,
        meter : meter.meter,
        requestIdleCallback : (callback) => {
            const id = nextHandle++;
            waiting.set(id, callback);
            return id;
        },
        cancelIdleCallback : (id) => { waiting.delete(id); },
    }, conditions);
    return {
        fake,
        meter,
        handle,
        idle(time : number, didTimeout = false, timeRemaining = 12) {
            fake.setNow(time);
            const callbacks = [...waiting.values()];
            waiting.clear();
            for (const callback of callbacks) callback({ didTimeout, timeRemaining : () => timeRemaining });
        },
        waitingCallbacks : () => waiting.size,
    };
}

describe("createInstrumentedIdleAvailability", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("records the idle time, the gap after the first callback, and counts the callbacks by timeout", () => {
        const t = setup(false);

        t.idle(1_000, false, 12);
        t.idle(1_050, true, 0);
        t.handle.stop();

        expect(t.handle.monitor).toBeDefined();
        expect(t.meter.values("lag_idle_time_remaining_histogram")).toEqual([12, 0]);
        // The first callback has no gap
        expect(t.meter.values("lag_idle_gap_histogram")).toEqual([50]);
        expect(t.meter.records().get("lag_idle_callbacks")).toEqual([
            { value : 1, attributes : { timed_out : "false" } },
            { value : 1, attributes : { timed_out : "true" } },
        ]);
        expectCatalogInstruments(t.meter);
    });

    it("with measurement conditions, waits for late evidence before it records a gap of 5 s or more", () => {
        const t = setup(true);

        t.idle(1_000);
        t.idle(7_000);
        expect(t.meter.values("lag_idle_gap_histogram")).toEqual([]);
        vi.advanceTimersByTime(2_000);

        expect(t.meter.values("lag_idle_gap_histogram")).toEqual([6_000]);
    });

    it("with measurement conditions, stops while the page is hidden and starts again when it is visible", () => {
        const t = setup(true);
        t.idle(1_000);

        t.fake.setVisibility("hidden");
        expect(t.waitingCallbacks()).toBe(0);
        t.fake.setVisibility("visible");

        expect(t.waitingCallbacks()).toBe(1);
    });

    it("stop() cancels the gaps that wait for evidence, and the page lifecycle does not start the monitor again", () => {
        const t = setup(true);
        t.idle(1_000);
        t.idle(7_000);

        t.handle.stop();
        vi.advanceTimersByTime(3_000);
        t.fake.setVisibility("hidden");
        t.fake.setVisibility("visible");

        expect(t.meter.values("lag_idle_gap_histogram")).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        expect(t.waitingCallbacks()).toBe(0);
    });
});
