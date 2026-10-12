import { describe, expect, it, vi } from "vitest";
import { addCallbackHook as libraryAddCallbackHook } from "async-browser-context";
import { activeSpanName, createInstrumentedLongCallbacks, setupLongCallbacks } from "./long-callbacks.js";
import type { AddCallbackHookFn, CallbackHookLike, LongCallbackOptions } from "./LongCallbackMonitor.js";
import * as addOn from "./index.js";
import { setupAllMonitors, type AllMonitorDeps } from "../setup-all-monitors.js";
import { createRecordingMeter, createRecordingSpanSink, expectCatalogEvents, expectCatalogInstruments, expectCatalogSpans } from "../test-utils.js";
import { createFakeEventTarget, createFakePage, createFakePerformanceObserver } from "../vitals/test-fakes.js";
import { EVENTS, HISTOGRAM_BOUNDARIES, METRICS } from "../metric-catalog.js";

const TIME_ORIGIN = 1_700_000_000_000;
const VIEW = { traceId : "a".repeat(32), spanId : "b".repeat(16) };

/**
 * A fake of the callback hooks of async-browser-context, with a clock.
 * `run` starts `before`, moves the clock by `durationMs`, and starts
 * `after`, as the library does around a callback.
 */
function createHookHost() {
    let hooks : CallbackHookLike[] = [];
    let now = 0;
    const addCallbackHook = vi.fn((hook : CallbackHookLike) => {
        hooks = [...hooks, hook];
        return () => { hooks = hooks.filter(other => other !== hook); };
    });
    return {
        addCallbackHook,
        clock : { now : () => now },
        advance : (ms : number) => { now += ms; },
        run(callback : Function, source : string, durationMs : number) : void {
            const current = hooks;
            for (const hook of current) hook.before?.(callback, source);
            now += durationMs;
            for (const hook of [...current].reverse()) hook.after?.(callback, source);
        },
        hookCount : () => hooks.length,
    };
}

function setup(options : { events? : boolean; spans? : boolean; clock? : boolean; monitor? : LongCallbackOptions } = {}) {
    const host = createHookHost();
    const meter = createRecordingMeter();
    const events = { emit : vi.fn() };
    const spans = createRecordingSpanSink();
    const logger = { log : vi.fn() };
    const handle = createInstrumentedLongCallbacks({
        logger,
        clock : host.clock,
        meter : meter.meter,
        addCallbackHook : host.addCallbackHook,
        ...(options.clock !== false ? { performance : { timeOrigin : TIME_ORIGIN, now : host.clock.now } } : {}),
        ...(options.events !== false ? { events } : {}),
        ...(options.spans === true ? { spans, pageViewSpans : { viewStarted() {}, viewHidden() {}, viewEnded() {}, current : () => VIEW } } : {}),
    }, options.monitor);
    return { host, meter, events, spans, logger, handle };
}

function checkout() : void {}
function onBuyClick() : void {}

describe("createInstrumentedLongCallbacks", () => {
    it("records the duration of each long callback with its source kind, from the catalog", () => {
        const t = setup();

        t.host.run(checkout, "setTimeout", 49);
        t.host.run(checkout, "setTimeout", 50);
        t.host.run(onBuyClick, "addEventListener:click", 120);
        t.host.run(checkout, "await", 300);

        expect(t.handle.name).toBe("long-callbacks");
        expect(t.meter.records().get("lag_long_callback_duration_histogram")).toEqual([
            { value : 50, attributes : { source_kind : "timer" } },
            { value : 120, attributes : { source_kind : "event" } },
            { value : 300, attributes : { source_kind : "await" } },
        ]);
        expect(t.meter.instruments()[0]!.advice).toEqual({ explicitBucketBoundaries : HISTOGRAM_BOUNDARIES.duration });
        expectCatalogInstruments(t.meter);
    });

    it("sends an event with the callback, the source, the source kind and the duration, at the start of the callback", () => {
        const t = setup({ monitor : { operation : () => "checkout" } });

        t.host.advance(1_000);
        t.host.run(onBuyClick, "addEventListener:click", 150);

        expect(t.events.emit.mock.calls).toEqual([["lag.long_callback", {
            duration_ms : 150,
            "callback.name" : "onBuyClick",
            "callback.source" : "addEventListener:click",
            source_kind : "event",
            operation : "checkout",
        }, { time : TIME_ORIGIN + 1_000 }]]);
        expectCatalogEvents(t.events.emit);
    });

    it("sends no operation attribute without an operation", () => {
        const t = setup({ monitor : { operation : () => undefined } });

        t.host.run(checkout, "Promise.then", 60);

        expect(t.events.emit.mock.calls[0]![1]).not.toHaveProperty("operation");
        expect(t.events.emit.mock.calls[0]![1]).toEqual({ duration_ms : 60, "callback.name" : "checkout", "callback.source" : "Promise.then", source_kind : "promise" });
    });

    it("uses the threshold of the options for the metric and the events", () => {
        const t = setup({ monitor : { thresholdMs : 200 } });

        t.host.run(checkout, "setTimeout", 150);
        t.host.run(checkout, "setTimeout", 200);

        expect(t.meter.values("lag_long_callback_duration_histogram")).toEqual([200]);
        expect(t.events.emit).toHaveBeenCalledTimes(1);
    });

    it("sends no more than 10 events each minute, and records each callback", () => {
        const t = setup();

        for (let i = 0; i < 12; i++) t.host.run(checkout, "setTimeout", 100);
        expect(t.meter.values("lag_long_callback_duration_histogram")).toHaveLength(12);
        expect(t.events.emit).toHaveBeenCalledTimes(10);

        // 12 callbacks of 100 ms: the minute of the limit ends 60 s after the first event
        t.host.advance(60_000 - 1_200);
        t.host.run(checkout, "setTimeout", 100);
        expect(t.events.emit).toHaveBeenCalledTimes(11);
    });

    it("sends the event without a time when it has no clock for absolute times", () => {
        const t = setup({ clock : false, spans : true });

        t.host.run(checkout, "setTimeout", 100);

        expect(t.events.emit.mock.calls[0]![2]).toEqual({});
        // A span needs an absolute time
        expect(t.spans.spans).toEqual([]);
    });

    it("records only the histogram without events and spans", () => {
        const t = setup({ events : false });

        for (let i = 0; i < 12; i++) t.host.run(checkout, "setTimeout", 100);

        expect(t.meter.values("lag_long_callback_duration_histogram")).toHaveLength(12);
        expect(t.events.emit).not.toHaveBeenCalled();
        expect(t.logger.log).not.toHaveBeenCalled();
    });

    it("removes the hook at stop()", () => {
        const t = setup();

        expect(t.host.hookCount()).toBe(1);
        t.handle.stop();

        expect(t.host.hookCount()).toBe(0);
        expect(t.handle.monitor!.running).toBe(false);
    });

    it("gives a handle without a monitor when the hook function fails, and logs a warning", () => {
        const logger = { log : vi.fn() };
        const error = new TypeError("addCallbackHook: the hook is not an object");
        const handle = createInstrumentedLongCallbacks({
            logger,
            clock : { now : () => 0 },
            meter : createRecordingMeter().meter,
            addCallbackHook : () => { throw error; },
        });

        expect(handle.monitor).toBeUndefined();
        expect(() => handle.stop()).not.toThrow();
        expect(logger.log).toHaveBeenCalledWith("warn", "Failed to create the \"long-callbacks\" monitor.", { error, monitor : "long-callbacks" });
    });
});

describe("createInstrumentedLongCallbacks with spans", () => {
    it("records a span from the start to the end of each long callback, in the current page view", () => {
        const t = setup({ spans : true, monitor : { operation : () => "checkout" } });

        t.host.advance(2_000);
        t.host.run(checkout, "await", 80);

        expect(t.spans.spans).toEqual([expect.objectContaining({
            name : "lag.long_callback",
            startTime : TIME_ORIGIN + 2_000,
            endTime : TIME_ORIGIN + 2_080,
            attributes : { duration_ms : 80, "callback.name" : "checkout", "callback.source" : "await", source_kind : "await", operation : "checkout" },
            parent : VIEW,
        })]);
        expectCatalogSpans(t.spans.spans);
    });

    it("records the spans without an event sink, with the same limit of 10 each minute", () => {
        const t = setup({ events : false, spans : true });

        for (let i = 0; i < 12; i++) t.host.run(checkout, "setTimeout", 100);

        expect(t.spans.spans).toHaveLength(10);
        expect(t.events.emit).not.toHaveBeenCalled();
    });
});

/** The dependencies of `setupAllMonitors` with fakes, and timers that never start. */
function setupMonitors(host : ReturnType<typeof createHookHost>) {
    const meter = createRecordingMeter();
    const events = { emit : vi.fn() };
    const spans = createRecordingSpanSink();
    const deps : AllMonitorDeps = {
        logger : { log : vi.fn() },
        clock : host.clock,
        meter : meter.meter,
        events,
        spans,
        setTimeoutFn : () => 1,
        clearTimeoutFn : () => {},
        setIntervalFn : () => 1,
        clearIntervalFn : () => {},
        document : Object.assign(createFakeEventTarget(), { visibilityState : "visible", hasFocus : () => true }),
        window : createFakeEventTarget(),
        PerformanceObserver : createFakePerformanceObserver(["event", "first-input", "layout-shift", "paint", "largest-contentful-paint"]).PerformanceObserver,
        performance : { timeOrigin : TIME_ORIGIN, now : host.clock.now },
        page : createFakePage(),
    };
    return { monitors : setupAllMonitors(deps), meter, events, spans };
}

describe("setupLongCallbacks", () => {
    it("adds the monitor to the setup: the events have the page-view ID, the spans are in the page view, and stop() removes the hook", () => {
        const host = createHookHost();
        const t = setupMonitors(host);

        const handle = setupLongCallbacks(t.monitors, host.addCallbackHook, { operation : () => "checkout", thresholdMs : 100 });
        host.advance(500);
        host.run(checkout, "setTimeout", 90);
        host.run(checkout, "setTimeout", 100);

        expect(t.monitors.registry.get("long-callbacks")).toBe(handle);
        const viewId = t.monitors.vitals!.getView().id;
        const calls = t.events.emit.mock.calls.filter(([name]) => name === "lag.long_callback");
        expect(calls).toEqual([["lag.long_callback", {
            "lag.page_view.id" : viewId,
            duration_ms : 100,
            "callback.name" : "checkout",
            "callback.source" : "setTimeout",
            source_kind : "timer",
            operation : "checkout",
        }, { time : TIME_ORIGIN + 590 }]]);
        expectCatalogEvents(t.events.emit, ["lag.page_view.id"]);
        // The catalog lists each attribute of the event, also the page-view ID that the setup adds
        expect(EVENTS.longCallback.attributes).toEqual(expect.arrayContaining(Object.keys(calls[0]![1] as object)));

        const [view] = t.spans.named("lag.page_view");
        expect(t.spans.named("lag.long_callback")).toEqual([expect.objectContaining({ startTime : TIME_ORIGIN + 590, endTime : TIME_ORIGIN + 690, parent : view!.identity })]);
        expectCatalogSpans(t.spans.spans);
        expect(t.meter.values("lag_long_callback_duration_histogram")).toEqual([100]);

        expect(host.hookCount()).toBe(1);
        t.monitors.stop();
        expect(host.hookCount()).toBe(0);
    });

    it("takes the addCallbackHook function of async-browser-context, which does nothing on Node.js", () => {
        const host = createHookHost();
        const t = setupMonitors(host);
        const fn : AddCallbackHookFn = libraryAddCallbackHook;

        const handle = setupLongCallbacks(t.monitors, fn);

        expect(handle.monitor!.running).toBe(true);
        t.monitors.stop();
        expect(handle.monitor!.running).toBe(false);
    });
});

describe("activeSpanName", () => {
    it("gives the name of the active span of the SDK", () => {
        const getActiveSpan = vi.fn<() => object | undefined>(() => ({ name : "checkout", spanContext() {} }));
        const operation = activeSpanName({ trace : { getActiveSpan } });

        expect(getActiveSpan).not.toHaveBeenCalled();
        expect(operation()).toBe("checkout");
        expect(getActiveSpan).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["no active span", undefined],
        ["a span without a name (not recording)", { spanContext() {} }],
        ["a name that is not a string", { name : 7 }],
    ])("gives undefined for %s", (_case, span) => {
        expect(activeSpanName({ trace : { getActiveSpan : () => span } })()).toBeUndefined();
    });
});

describe("@mark1russell7/lag/async-context", () => {
    it("exports the add-on", () => {
        expect(Object.keys(addOn).sort()).toEqual([
            "ANONYMOUS_CALLBACK",
            "CALLBACK_SOURCE_KINDS",
            "LONG_CALLBACK_THRESHOLD_MS",
            "LongCallbackMonitor",
            "activeSpanName",
            "callbackSourceKind",
            "createInstrumentedLongCallbacks",
            "setupLongCallbacks",
        ]);
    });

    it("puts typical durations of long callbacks into different buckets", () => {
        const boundaries = METRICS.longCallbackDuration.advice!.explicitBucketBoundaries;
        const bucketOf = (value : number) : number => boundaries.findIndex(boundary => value <= boundary);
        expect(new Set([50, 60, 120, 180, 250, 400, 700, 1_500, 6_000].map(bucketOf)).size).toBe(9);
    });
});
