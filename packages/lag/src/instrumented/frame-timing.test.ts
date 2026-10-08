import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstrumentedFrameTiming } from "./frame-timing.js";
import { createMeasurementConditions } from "../measurement-conditions.js";
import { createFakeLifecycle } from "../vitals/test-fakes.js";
import { createRecordingMeter, expectCatalogInstruments } from "../test-utils.js";

/** Animation frames on demand, on the clock of a fake lifecycle. `frame(time)` starts the callbacks that wait. */
function setup(withConditions : boolean) {
    const fake = createFakeLifecycle();
    const waiting = new Map<number, () => void>();
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
    const handle = createInstrumentedFrameTiming({
        logger : { log : vi.fn() },
        clock : fake.clock,
        meter : meter.meter,
        requestAnimationFrame : (callback) => {
            const id = nextHandle++;
            waiting.set(id, () => callback(fake.clock.now()));
            return id;
        },
        cancelAnimationFrame : (id) => { waiting.delete(id); },
    }, conditions);
    return {
        fake,
        meter,
        handle,
        frame(time : number) {
            fake.setNow(time);
            const callbacks = [...waiting.values()];
            waiting.clear();
            for (const callback of callbacks) callback();
        },
        waitingFrames : () => waiting.size,
    };
}

describe("createInstrumentedFrameTiming", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("records the time between two frames, and counts the delivered frames and the dropped frames", () => {
        const t = setup(false);

        t.frame(1_000);
        t.frame(1_016);
        // At 16 ms for each frame, a gap of 50 ms shows that 2 frames did not come
        t.frame(1_066);
        t.handle.stop();

        expect(t.handle.monitor).toBeDefined();
        expect(t.meter.values("lag_frame_delta_histogram")).toEqual([16, 50]);
        expect(t.meter.records().get("lag_frames")).toEqual([
            { value : 1, attributes : { outcome : "delivered" } },
            { value : 1, attributes : { outcome : "delivered" } },
            { value : 2, attributes : { outcome : "dropped" } },
        ]);
        expectCatalogInstruments(t.meter);
    });

    it("with measurement conditions, waits for late evidence before it records a frame gap of 5 s or more", () => {
        const t = setup(true);

        t.frame(1_000);
        t.frame(7_000);
        expect(t.meter.values("lag_frame_delta_histogram")).toEqual([]);
        vi.advanceTimersByTime(2_000);

        expect(t.meter.values("lag_frame_delta_histogram")).toEqual([6_000]);
    });

    it("with measurement conditions, stops while the page is hidden and starts again when it is visible", () => {
        const t = setup(true);
        t.frame(1_000);

        t.fake.setVisibility("hidden");
        expect(t.waitingFrames()).toBe(0);
        t.fake.setVisibility("visible");

        expect(t.waitingFrames()).toBe(1);
    });

    it("stop() cancels the frame gaps that wait for evidence, and the page lifecycle does not start the monitor again", () => {
        const t = setup(true);
        t.frame(1_000);
        t.frame(7_000);

        t.handle.stop();
        vi.advanceTimersByTime(3_000);
        t.fake.setVisibility("hidden");
        t.fake.setVisibility("visible");

        expect(t.meter.values("lag_frame_delta_histogram")).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        expect(t.waitingFrames()).toBe(0);
    });
});
