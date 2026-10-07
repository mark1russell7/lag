import { describe, expect, it, vi } from "vitest";
import { createInstrumentedPageViewVitals } from "./page-view-vitals.js";
import { createFakeLifecycle, createFakePage, createFakePerformanceObserver, eventEntry, paintEntry } from "../vitals/test-fakes.js";
import { createRecordingMeter } from "../test-utils.js";

function setup() {
    const fake = createFakeLifecycle();
    const observer = createFakePerformanceObserver(["event", "first-input", "layout-shift", "paint", "largest-contentful-paint"]);
    const recording = createRecordingMeter();
    const events = { emit : vi.fn() };
    const handle = createInstrumentedPageViewVitals({
        logger : { log : vi.fn() },
        clock : fake.clock,
        meter : recording.meter,
        PerformanceObserver : observer.PerformanceObserver,
        page : createFakePage(),
        events,
    }, fake.lifecycle);
    return { fake, observer, recording, events, vitals : handle.monitor!, handle };
}

describe("createInstrumentedPageViewVitals", () => {
    it("records each vital of a view one time, also when a flush comes after the final report (Firefox and WebKit)", () => {
        const t = setup();
        t.observer.deliver("paint", paintEntry(500));
        t.observer.deliver("event", eventEntry({ interactionId : 5, startTime : 1_000, duration : 120 }));
        t.fake.setVisibility("hidden");
        t.fake.pagehide(false);
        // The exporter flushes the monitors before its last export
        t.vitals.flush();

        expect(t.recording.values("lag_web_vital_fcp_histogram")).toEqual([500]);
        expect(t.recording.values("lag_web_vital_inp_histogram")).toEqual([120]);
    });

    it("records each vital of a view one time with the event sequence of the specification", () => {
        const t = setup();
        t.observer.deliver("paint", paintEntry(500));
        t.fake.pagehide(false);
        t.fake.setVisibility("hidden");
        t.vitals.flush();

        expect(t.recording.values("lag_web_vital_fcp_histogram")).toEqual([500]);
    });

    it("records each vital of a view one time when stop() comes after the final report", () => {
        const t = setup();
        t.observer.deliver("paint", paintEntry(500));
        t.fake.pagehide(false);
        t.handle.stop();

        expect(t.recording.values("lag_web_vital_fcp_histogram")).toEqual([500]);
    });

    it("sends events whose deltas add up to the value", () => {
        const t = setup();
        t.observer.deliver("paint", paintEntry(500));
        t.fake.setVisibility("hidden");
        t.fake.pagehide(false);
        t.vitals.flush();

        const deltas = t.events.emit.mock.calls
            .filter(([, attributes]) => attributes["browser.web_vital.name"] === "fcp")
            .map(([, attributes]) => attributes["browser.web_vital.delta"] as number);
        expect(deltas.reduce((sum, delta) => sum + delta, 0)).toBe(500);
    });
});
