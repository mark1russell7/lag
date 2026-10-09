import { describe, expect, it, vi } from "vitest";
import { createInstrumentedLoaf } from "./loaf.js";
import { createFakePerformanceObserver } from "../vitals/test-fakes.js";
import { createRecordingMeter, createRecordingSpanSink, expectCatalogEvents, expectCatalogInstruments, expectCatalogSpans } from "../test-utils.js";
import type { LoafEntry } from "../perf-types.js";

const VIEW = { traceId : "a".repeat(32), spanId : "b".repeat(16) };

function setup(withEvents : boolean, withSpans = false, withClock = true) {
    const observer = createFakePerformanceObserver(["long-animation-frame"]);
    const meter = createRecordingMeter();
    const events = { emit : vi.fn() };
    const spans = createRecordingSpanSink();
    const logger = { log : vi.fn() };
    const handle = createInstrumentedLoaf({
        logger,
        clock : { now : () => 0 },
        meter : meter.meter,
        PerformanceObserver : observer.PerformanceObserver,
        ...(withClock ? { performance : { timeOrigin : 1_000_000, now : () => 0 } } : {}),
        ...(withEvents ? { events } : {}),
        ...(withSpans ? { spans, pageViewSpans : { viewStarted() {}, viewHidden() {}, viewEnded() {}, current : () => VIEW } } : {}),
    });
    return { observer, meter, events, spans, logger, handle };
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

    it.each([
        ["classic-script", "https://shop.example/checkout?session=SECRET#step2", "https://shop.example/checkout"],
        ["module-script", "https://shop.example/app.mjs?token=1", "https://shop.example/app.mjs"],
        ["event-listener", "IMG[src=https://cdn.example/a.png?sig=SECRET#x].onload", "IMG[src=https://cdn.example/a.png].onload"],
        ["event-listener", "BUTTON#buy.onclick", "BUTTON#buy.onclick"],
        ["user-callback", "Window.setTimeout", "Window.setTimeout"],
    ])("removes the query string and the fragment from a URL in the invoker of the type %s", (invokerType, invoker, expected) => {
        const t = setup(true);
        const entry : LoafEntry = {
            ...frame(200),
            scripts : [{
                name : "script",
                invoker,
                invokerType,
                startTime : 100,
                executionStart : 101,
                duration : 180,
                forcedStyleAndLayoutDuration : 0,
                sourceURL : "https://shop.example/app.js",
            }],
        };

        t.observer.deliver("long-animation-frame", entry);

        expect(t.events.emit.mock.calls[0]![1]["script.invoker"]).toBe(expected);
    });
});

describe("createInstrumentedLoaf with spans", () => {
    it("records a span from the start to the end of each frame that gets an event, in the current page view", () => {
        const t = setup(true, true);

        t.observer.deliver("long-animation-frame", frame(149), frame(150));

        expect(t.spans.spans).toEqual([expect.objectContaining({
            name : "lag.long_animation_frame",
            startTime : 1_000_100,
            endTime : 1_000_300,
            attributes : { duration_ms : 200, blocking_duration_ms : 150 },
            parent : VIEW,
        })]);
        expectCatalogSpans(t.spans.spans);
    });

    it("records no span without a clock, because the frame has no absolute time", () => {
        const t = setup(true, true, false);

        t.observer.deliver("long-animation-frame", frame(200));

        expect(t.events.emit).toHaveBeenCalledTimes(1);
        expect(t.spans.spans).toEqual([]);
    });

    it("records the spans without an event sink, with the same limit of 10 each minute", () => {
        const t = setup(false, true);

        t.observer.deliver("long-animation-frame", ...Array.from({ length : 12 }, () => frame(200)));

        expect(t.spans.spans).toHaveLength(10);
        expect(t.events.emit).not.toHaveBeenCalled();
    });
});
