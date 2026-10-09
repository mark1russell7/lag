import { describe, expect, it, vi } from "vitest";
import { createInstrumentedLoaf } from "./loaf.js";
import { createFakePerformanceObserver } from "../vitals/test-fakes.js";
import { createRecordingMeter, expectCatalogEvents, expectCatalogInstruments } from "../test-utils.js";
import type { LoafEntry } from "../perf-types.js";

function setup(withEvents : boolean) {
    const observer = createFakePerformanceObserver(["long-animation-frame"]);
    const meter = createRecordingMeter();
    const events = { emit : vi.fn() };
    const logger = { log : vi.fn() };
    const handle = createInstrumentedLoaf({
        logger,
        clock : { now : () => 0 },
        meter : meter.meter,
        PerformanceObserver : observer.PerformanceObserver,
        performance : { timeOrigin : 1_000_000, now : () => 0 },
        ...(withEvents ? { events } : {}),
    });
    return { observer, meter, events, logger, handle };
}

function frame(blockingDuration : number) : LoafEntry {
    return {
        entryType : "long-animation-frame",
        name : "",
        startTime : 100,
        duration : blockingDuration + 50,
        blockingDuration,
        renderStart : 0,
        styleAndLayoutStart : 0,
        scripts : [],
    };
}

describe("createInstrumentedLoaf", () => {
    it("records each frame, and sends an event only for a frame that blocks for 150 ms or more", () => {
        const t = setup(true);

        t.observer.deliver("long-animation-frame", frame(149), frame(150));

        expect(t.meter.values("lag_loaf_blocking_histogram")).toEqual([149, 150]);
        expect(t.meter.values("lag_loaf_duration_histogram")).toEqual([199, 200]);
        // At the start time of the frame (100 ms after the time origin)
        expect(t.events.emit.mock.calls).toEqual([["lag.long_animation_frame", { duration_ms : 200, blocking_duration_ms : 150 }, { time : 1_000_100 }]]);
        expectCatalogInstruments(t.meter);
        expectCatalogEvents(t.events.emit);
    });

    it("sends no more than 10 events each minute", () => {
        const t = setup(true);

        t.observer.deliver("long-animation-frame", ...Array.from({ length : 12 }, () => frame(200)));

        expect(t.meter.values("lag_loaf_blocking_histogram")).toHaveLength(12);
        expect(t.events.emit).toHaveBeenCalledTimes(10);
    });

    it("records the frames without an event sink", () => {
        const t = setup(false);

        t.observer.deliver("long-animation-frame", frame(200));

        expect(t.meter.values("lag_loaf_blocking_histogram")).toEqual([200]);
        expect(t.logger.log).not.toHaveBeenCalled();
    });

    it("names the longest script in the event, without the query of its URL", () => {
        const t = setup(true);

        const entry : LoafEntry = {
            ...frame(200),
            scripts : [{
                name : "script",
                invoker : "BUTTON#buy.onclick",
                invokerType : "event-listener",
                startTime : 100,
                executionStart : 101,
                duration : 180,
                forcedStyleAndLayoutDuration : 0,
                sourceURL : "https://shop.example/app.js?v=3",
            }],
        };
        t.observer.deliver("long-animation-frame", entry);

        expect(t.events.emit).toHaveBeenCalledWith("lag.long_animation_frame", {
            duration_ms : 250,
            blocking_duration_ms : 200,
            "script.invoker" : "BUTTON#buy.onclick",
            "script.invoker_type" : "event-listener",
            "script.source_url" : "https://shop.example/app.js",
            "script.duration_ms" : 180,
        }, { time : 1_000_100 });
        expectCatalogEvents(t.events.emit);
    });
});
