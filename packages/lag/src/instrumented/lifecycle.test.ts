import { describe, expect, it, vi } from "vitest";
import { createInstrumentedLifecycle } from "./lifecycle.js";
import { createFakeLifecycle } from "../vitals/test-fakes.js";
import { createRecordingMeter, expectCatalogEvents, expectCatalogInstruments } from "../test-utils.js";

function setup(withClock = true) {
    const fake = createFakeLifecycle();
    const meter = createRecordingMeter();
    const events = { emit : vi.fn() };
    const handle = createInstrumentedLifecycle({
        logger : { log : vi.fn() },
        clock : fake.clock,
        meter : meter.meter,
        document : fake.document,
        window : fake.window,
        events,
        ...(withClock ? { performance : { timeOrigin : 1_700_000_000_000, now : () => fake.clock.now() } } : {}),
    });
    return { fake, meter, events, handle };
}

describe("createInstrumentedLifecycle", () => {
    it("counts each transition, and emits an event at the time of the browser event", () => {
        const t = setup();
        t.fake.setNow(5_000);
        t.fake.setVisibility("hidden", 4_200);
        t.fake.setNow(9_000);
        t.fake.pagehide(true);

        expect(t.meter.records().get("lag_lifecycle_transitions")).toEqual([
            { value : 1, attributes : { from : "active", to : "hidden", trigger : "visibilitychange" } },
            { value : 1, attributes : { from : "hidden", to : "frozen", trigger : "pagehide" } },
        ]);
        expect(t.events.emit.mock.calls).toEqual([
            // The time stamp of the event, not the time at which the machine handled it
            ["lag.lifecycle.transition", { from : "active", to : "hidden", trigger : "visibilitychange" }, { time : 1_700_000_004_200 }],
            // An event without a time stamp: the time at which the machine handled it
            ["lag.lifecycle.transition", { from : "hidden", to : "frozen", trigger : "pagehide" }, { time : 1_700_000_009_000 }],
        ]);
        expectCatalogInstruments(t.meter);
        expectCatalogEvents(t.events.emit);
        t.handle.stop();
    });

    it("emits the events without a time when it has no clock, and stops with the machine", () => {
        const t = setup(false);
        t.fake.setVisibility("hidden");
        expect(t.events.emit).toHaveBeenCalledWith("lag.lifecycle.transition", { from : "active", to : "hidden", trigger : "visibilitychange" }, {});

        t.handle.stop();
        t.fake.setVisibility("visible");
        expect(t.events.emit).toHaveBeenCalledTimes(1);
    });
});
