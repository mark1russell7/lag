import { describe, expect, it, vi } from "vitest";
import { createInstrumentedEventTiming } from "./event-timing.js";
import { createFakePerformanceObserver, eventEntry } from "../vitals/test-fakes.js";
import { createRecordingMeter, expectCatalogInstruments } from "../test-utils.js";
import type { PerformanceLike } from "../types.js";

function setup(performance? : PerformanceLike) {
    const observer = createFakePerformanceObserver(["event"]);
    const meter = createRecordingMeter();
    const handle = createInstrumentedEventTiming({
        logger : { log : vi.fn() },
        clock : { now : () => 0 },
        meter : meter.meter,
        PerformanceObserver : observer.PerformanceObserver,
        ...(performance ? { performance } : {}),
    });
    return { observer, meter, handle };
}

describe("createInstrumentedEventTiming", () => {
    it("records the duration and the three phases of each interaction event, with the interaction type", () => {
        const t = setup();

        t.observer.deliver("event", eventEntry({ interactionId : 5, startTime : 100, duration : 200, name : "keydown", processingStart : 130, processingEnd : 210 }));

        const keyboard = { interaction : "keyboard" };
        expect(t.meter.records().get("lag_event_duration_histogram")).toEqual([{ value : 200, attributes : keyboard }]);
        expect(t.meter.records().get("lag_event_input_delay_histogram")).toEqual([{ value : 30, attributes : keyboard }]);
        expect(t.meter.records().get("lag_event_processing_histogram")).toEqual([{ value : 80, attributes : keyboard }]);
        expect(t.meter.records().get("lag_event_presentation_delay_histogram")).toEqual([{ value : 90, attributes : keyboard }]);
        expectCatalogInstruments(t.meter);
    });

    it("records 0 for a phase that the clock rounding makes negative", () => {
        const t = setup();

        // The processing starts 0.5 ms before the recorded start of the event, and ends before it starts
        t.observer.deliver("event", eventEntry({ interactionId : 5, startTime : 100, duration : 104, processingStart : 99.5, processingEnd : 99 }));

        expect(t.meter.values("lag_event_input_delay_histogram")).toEqual([0]);
        expect(t.meter.values("lag_event_processing_histogram")).toEqual([0]);
    });

    it("gives the monitor the interaction count of the page", () => {
        let count = 0;
        const t = setup({ timeOrigin : 0, now : () => 0, get interactionCount() { return count; } });
        count = 200;

        expect(t.handle.monitor!.getInteractionCount()).toBe(200);
    });
});
