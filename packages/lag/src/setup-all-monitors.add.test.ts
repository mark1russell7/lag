import { describe, expect, it, vi } from "vitest";
import { setupAllMonitors, type AllMonitorDeps, type SetupDeps } from "./setup-all-monitors.js";
import { createRecordingMeter, createRecordingSpanSink } from "./test-utils.js";
import { createFakeEventTarget, createFakePage, createFakePerformanceObserver } from "./vitals/test-fakes.js";

const TIME_ORIGIN = 1_700_000_000_000;

/** The dependencies of `setupAllMonitors` with fakes. The timers never start. */
function setup() {
    const events = { emit : vi.fn() };
    const spans = createRecordingSpanSink();
    const deps : AllMonitorDeps = {
        logger : { log : vi.fn() },
        clock : { now : () => 250 },
        meter : createRecordingMeter().meter,
        events,
        spans,
        setTimeoutFn : () => 1,
        clearTimeoutFn : () => {},
        setIntervalFn : () => 1,
        clearIntervalFn : () => {},
        document : Object.assign(createFakeEventTarget(), { visibilityState : "visible", hasFocus : () => true }),
        window : createFakeEventTarget(),
        PerformanceObserver : createFakePerformanceObserver(["event", "first-input", "layout-shift", "paint", "largest-contentful-paint"]).PerformanceObserver,
        performance : { timeOrigin : TIME_ORIGIN, now : () => 250 },
        page : createFakePage(),
        pageId : "page-1",
    };
    return { deps, events, spans, monitors : setupAllMonitors(deps) };
}

describe("AllMonitorHandles.add", () => {
    it("makes the monitor with the dependencies of the setup, and registers its handle", () => {
        const t = setup();
        let received : SetupDeps | undefined;
        const stop = vi.fn();

        const handle = t.monitors.add((deps) => {
            received = deps;
            return { name : "custom", monitor : 42, stop };
        });

        expect(handle).toEqual({ name : "custom", monitor : 42, stop });
        expect(t.monitors.registry.get("custom")).toBe(handle);
        expect(t.monitors.registry.getAll().at(-1)).toBe(handle);
        // The dependencies of the app, and the parts that the setup makes
        expect(received).toMatchObject({ clock : t.deps.clock, meter : t.deps.meter, logger : t.deps.logger, spans : t.spans, pageId : "page-1" });
        expect(received!.absoluteClock!.origin).toBe(TIME_ORIGIN);
        const [view] = t.spans.named("lag.page_view");
        expect(received!.pageViewSpans!.current()).toEqual(view!.identity);
    });

    it("gives the monitor the event sink that adds the ID of the current page view", () => {
        const t = setup();

        t.monitors.add((deps) => {
            deps.events!.emit("lag.custom", { value : 1 });
            return { name : "custom", monitor : undefined, stop() {} };
        });

        expect(t.events.emit).toHaveBeenLastCalledWith("lag.custom", { "lag.page_view.id" : t.monitors.vitals!.getView().id, value : 1 });
    });

    it("stops the added monitor first with stop(), because it is the last handle", () => {
        const t = setup();
        const order : string[] = [];
        const lifecycleStop = t.monitors.registry.get("lifecycle")!.stop;
        vi.spyOn(t.monitors.registry.get("lifecycle")!, "stop").mockImplementation(() => {
            order.push("lifecycle");
            lifecycleStop();
        });

        t.monitors.add(() => ({ name : "custom", monitor : undefined, stop : () => order.push("custom") }));
        t.monitors.stop();

        expect(order).toEqual(["custom", "lifecycle"]);
        expect(t.monitors.registry.size).toBe(0);
    });
});
