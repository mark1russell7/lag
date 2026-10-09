import { describe, expect, it, vi } from "vitest";
import { createInstrumentedLifecycle } from "./lifecycle.js";
import { createFakeLifecycle } from "../vitals/test-fakes.js";
import { createRecordingMeter, createRecordingSpanSink, expectCatalogEvents, expectCatalogInstruments, expectCatalogSpans } from "../test-utils.js";
import { LifecycleStateMachine } from "../LifecycleStateMachine.js";

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

describe("createInstrumentedLifecycle with spans", () => {
    const VIEW = { traceId : "a".repeat(32), spanId : "b".repeat(16) };

    function withSpans(withClock = true, withViews = true) {
        const fake = createFakeLifecycle();
        const spans = createRecordingSpanSink();
        const handle = createInstrumentedLifecycle({
            logger : { log : vi.fn() },
            clock : fake.clock,
            meter : createRecordingMeter().meter,
            document : fake.document,
            window : fake.window,
            spans,
            ...(withViews ? { pageViewSpans : { viewStarted() {}, viewHidden() {}, viewEnded() {}, current : () => VIEW } } : {}),
            ...(withClock ? { performance : { timeOrigin : 1_700_000_000_000, now : () => fake.clock.now() } } : {}),
        });
        return { fake, spans, handle };
    }

    it("records each hidden and frozen period as a span in the current page view, to the next transition", () => {
        const t = withSpans();
        t.fake.setNow(5_000);
        t.fake.setVisibility("hidden", 4_200);
        t.fake.setNow(9_000);
        t.fake.pagehide(true);
        t.fake.setNow(60_000);
        t.fake.pageshow(true, 59_000);

        expect(t.spans.spans.map(span => [span.name, span.startTime, span.endTime, span.attributes["trigger"], span.parent])).toEqual([
            ["lag.page.hidden", 1_700_000_004_200, 1_700_000_009_000, "visibilitychange", VIEW],
            ["lag.page.frozen", 1_700_000_009_000, 1_700_000_059_000, "pagehide", VIEW],
        ]);
        expectCatalogSpans(t.spans.spans);
        t.handle.stop();
    });

    it("ends the open period at stop(), and records no period after the stop", () => {
        const t = withSpans();
        t.fake.setNow(1_000);
        t.fake.setVisibility("hidden");
        t.fake.setNow(3_000);
        t.handle.stop();
        t.fake.setVisibility("visible");
        t.fake.setVisibility("hidden");

        expect(t.spans.spans.map(span => [span.startTime, span.endTime])).toEqual([[1_700_000_001_000, 1_700_000_003_000]]);
    });

    it("uses Date.now() without a clock, also at stop(), and starts a new trace without page-view spans", () => {
        vi.useFakeTimers({ now : 50_000 });
        const t = withSpans(false, false);
        t.fake.setVisibility("hidden");
        vi.advanceTimersByTime(2_000);
        t.fake.setVisibility("visible");
        t.fake.setVisibility("hidden");
        vi.advanceTimersByTime(1_000);
        t.handle.stop();

        expect(t.spans.spans.map(span => [span.startTime, span.endTime, span.parent])).toEqual([[50_000, 52_000, undefined], [52_000, 53_000, undefined]]);
        vi.useRealTimers();
    });
});

describe("createInstrumentedLifecycle with a tracker that the page shares", () => {
    it("subscribes to the tracker, and at stop() it unsubscribes but does not dispose of the tracker", () => {
        const fake = createFakeLifecycle();
        const shared = new LifecycleStateMachine(fake.document, fake.window, fake.clock, { log : vi.fn() });
        const exporter = vi.fn();
        shared.subscribe(exporter, { phase : "export" });
        const meter = createRecordingMeter();
        const handle = createInstrumentedLifecycle({
            logger : { log : vi.fn() },
            clock : fake.clock,
            meter : meter.meter,
            document : fake.document,
            window : fake.window,
            lifecycleTracker : shared,
        });

        expect(handle.monitor).toBe(shared);
        fake.setVisibility("hidden");
        expect(meter.records().get("lag_lifecycle_transitions")).toHaveLength(1);

        handle.stop();
        fake.setVisibility("visible");
        // The tracker still operates for the other libraries of the page, without the counter of lag
        expect(exporter).toHaveBeenCalledTimes(2);
        expect(meter.records().get("lag_lifecycle_transitions")).toHaveLength(1);
        shared.dispose();
    });
});
