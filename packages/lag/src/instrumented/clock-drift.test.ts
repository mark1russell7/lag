import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstrumentedClockDrift } from "./clock-drift.js";
import { createMeasurementConditions } from "../measurement-conditions.js";
import { createRecordingMeter, expectCatalogEvents, expectCatalogInstruments } from "../test-utils.js";

describe("createInstrumentedClockDrift", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function setup() {
        let mono = 0;
        let wallShift = 0;
        const clock = { now : () => mono };
        const conditions = createMeasurementConditions({
            clock,
            setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
            clearTimeoutFn : (id) => clearTimeout(id),
        });
        const meter = createRecordingMeter();
        const events = { emit : vi.fn() };
        const handle = createInstrumentedClockDrift({
            logger : { log : vi.fn() },
            clock,
            meter : meter.meter,
            performance : { timeOrigin : 1_700_000_000_000, now : () => mono },
            wallClock : { now : () => 1_700_000_000_000 + mono + wallShift },
            setIntervalFn : (fn, ms) => setInterval(fn, ms) as unknown as number,
            clearIntervalFn : (id) => clearInterval(id),
            events,
        }, conditions);
        return {
            handle, conditions, meter, events,
            advance(ms : number, wallExtra = 0) {
                mono += ms;
                wallShift += wallExtra;
                vi.advanceTimersByTime(ms);
            },
        };
    }

    it("adds a suspend to the measurement conditions, over the interval in which it occurred", () => {
        const t = setup();
        t.advance(1_000);
        t.advance(1_000, 60_000);

        expect(t.meter.records().get("lag_clock_jumps")).toEqual([{ value : 1, attributes : { direction : "forward", kind : "suspend" } }]);
        expect(t.conditions.tracker.findOverlap(1_500, 1_600)).toMatchObject({ reason : "suspend" });
        expect(t.conditions.tracker.findOverlap(500, 900)).toBeUndefined();
        t.handle.stop();
    });

    it("adds nothing for a clock step", () => {
        const t = setup();
        t.advance(1_000);
        t.advance(1_000, -5_000);

        // At the time at which the monitor found the jump
        expect(t.events.emit).toHaveBeenCalledWith("lag.clock.jump", expect.objectContaining({ kind : "step", direction : "backward" }), { time : 1_700_000_002_000 });
        expect(t.conditions.tracker.getIntervalCount()).toBe(0);
        t.handle.stop();
    });

    it("counts a clock jump without an event sink and without measurement conditions", () => {
        let mono = 0;
        let wallShift = 0;
        const meter = createRecordingMeter();
        const logger = { log : vi.fn() };
        const handle = createInstrumentedClockDrift({
            logger,
            clock : { now : () => mono },
            meter : meter.meter,
            performance : { timeOrigin : 1_700_000_000_000, now : () => mono },
            wallClock : { now : () => 1_700_000_000_000 + mono + wallShift },
            setIntervalFn : (fn, ms) => setInterval(fn, ms) as unknown as number,
            clearIntervalFn : (id) => clearInterval(id),
        });

        mono += 1_000;
        vi.advanceTimersByTime(1_000);
        mono += 1_000;
        wallShift += 60_000;
        vi.advanceTimersByTime(1_000);
        handle.stop();

        expect(meter.records().get("lag_clock_jumps")).toEqual([{ value : 1, attributes : { direction : "forward", kind : "suspend" } }]);
        expect(logger.log).not.toHaveBeenCalled();
    });

    it("records each kind of jump with the attribute values of the catalog, and events with the attributes of the catalog", () => {
        const t = setup();
        t.advance(1_000);
        t.advance(1_000, 60_000);
        t.advance(1_000, -5_000);
        t.advance(1_000, 300);
        t.handle.stop();

        expect(t.meter.records().get("lag_clock_jumps")!.map(r => r.attributes)).toEqual([
            { direction : "forward", kind : "suspend" },
            { direction : "backward", kind : "step" },
            { direction : "forward", kind : "step" },
        ]);
        expectCatalogInstruments(t.meter);
        expectCatalogEvents(t.events.emit);
    });
});
