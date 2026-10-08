import { describe, expect, it, vi } from "vitest";
import { createInstrumentedPageViewVitals } from "./page-view-vitals.js";
import {
    createFakeLifecycle,
    createFakePage,
    createFakePerformanceObserver,
    eventEntry,
    lcpEntry,
    paintEntry,
    type FakePage,
} from "../vitals/test-fakes.js";
import { createRecordingMeter, expectCatalogEvents } from "../test-utils.js";
import { METRICS } from "../metric-catalog.js";
import type { PerformanceEntryLike } from "../perf-types.js";
import type { RequestAnimationFrameFn } from "../FrameTimingMonitor.js";
import type { PerformanceLike } from "../types.js";

const LOAD_TYPES = ["event", "first-input", "layout-shift", "paint", "largest-contentful-paint"];

function setup(options : {
    page? : FakePage | undefined;
    performance? : PerformanceLike;
    describeNode? : (node : unknown) => string;
    softNavigations? : boolean;
    requestAnimationFrame? : RequestAnimationFrameFn;
    withoutEvents? : boolean;
    window? : boolean;
} = {}) {
    const fake = createFakeLifecycle();
    const observer = createFakePerformanceObserver([...LOAD_TYPES, "soft-navigation", "interaction-contentful-paint"]);
    const recording = createRecordingMeter();
    const events = { emit : vi.fn() };
    const page = "page" in options ? options.page : createFakePage();
    const handle = createInstrumentedPageViewVitals({
        logger : { log : vi.fn() },
        clock : fake.clock,
        meter : recording.meter,
        PerformanceObserver : observer.PerformanceObserver,
        ...(page ? { page } : {}),
        ...(options.withoutEvents ? {} : { events }),
        ...(options.performance ? { performance : options.performance } : {}),
        ...(options.describeNode ? { describeNode : options.describeNode } : {}),
        ...(options.softNavigations !== undefined ? { softNavigations : options.softNavigations } : {}),
        ...(options.requestAnimationFrame ? { requestAnimationFrame : options.requestAnimationFrame } : {}),
        ...(options.window ? { window : fake.window } : {}),
    }, fake.lifecycle);
    return { fake, observer, recording, events, vitals : handle.monitor!, handle };
}

/** The attributes of the `browser.web_vital` events of one vital, in the sequence of the events. */
function vitalEvents(emit : ReturnType<typeof vi.fn>, name : string) : Array<Record<string, unknown>> {
    return emit.mock.calls
        .filter(([event, attributes]) => event === "browser.web_vital" && (attributes as Record<string, unknown>)["browser.web_vital.name"] === name)
        .map(([, attributes]) => attributes as Record<string, unknown>);
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

        const deltas = vitalEvents(t.events.emit, "fcp").map(attributes => attributes["browser.web_vital.delta"] as number);
        expect(deltas.reduce((sum, delta) => sum + delta, 0)).toBe(500);
    });

    it("sends a second event with the change of the value when the value of a view changes, but records the first value only", () => {
        const t = setup();
        t.observer.deliver("event", eventEntry({ interactionId : 5, startTime : 1_000, duration : 120 }));
        t.fake.setVisibility("hidden");
        t.fake.setVisibility("visible");
        t.observer.deliver("event", eventEntry({ interactionId : 6, startTime : 2_000, duration : 300 }));
        t.fake.setVisibility("hidden");

        const inp = vitalEvents(t.events.emit, "inp").map(attributes => [attributes["browser.web_vital.value"], attributes["browser.web_vital.delta"]]);
        expect(inp).toEqual([[120, 120], [300, 180]]);
        // These events are the events of a view with a URL
        expectCatalogEvents(t.events.emit);
        expect(t.recording.values("lag_web_vital_inp_histogram")).toEqual([120]);
    });

    it("sends the attributes of the semantic conventions with the attribution, and no URL attribute for a view without a URL", () => {
        const t = setup({ page : undefined, describeNode : (node) => `node:${(node as { id : string }).id}` });
        t.observer.deliver("largest-contentful-paint", lcpEntry(800, { id : "hero" }));
        t.fake.setVisibility("hidden");

        const view = t.vitals.getView();
        const [lcp] = vitalEvents(t.events.emit, "lcp");
        expect(lcp).toEqual({
            "browser.web_vital.name" : "lcp",
            "browser.web_vital.value" : 800,
            "browser.web_vital.delta" : 800,
            "browser.web_vital.id" : `${view.id}-lcp`,
            "browser.web_vital.rating" : "good",
            "browser.web_vital.navigation_type" : "navigate",
            "lag.page_view.id" : view.id,
            "lag.web_vital.target" : "node:hero",
        });
        expect(Object.keys(lcp!)).not.toContain("lag.page_view.url");
        expectCatalogEvents(t.events.emit);
    });

    it("makes the LCP final at a trusted click on the window of the dependencies", () => {
        for (const window of [true, false]) {
            const t = setup({ window });
            t.observer.deliver("largest-contentful-paint", lcpEntry(700, { id : "headline" }));
            t.fake.setNow(1_100);
            t.fake.window.dispatch("click", { isTrusted : true, timeStamp : 1_000 });
            t.observer.deliver("largest-contentful-paint", lcpEntry(1_600, { id : "late" }));
            t.fake.setVisibility("hidden");

            // Without the window, the monitor does not see the click
            expect(t.recording.values("lag_web_vital_lcp_histogram")).toEqual([window ? 700 : 1_600]);
        }
    });

    it("records the vitals without an event sink", () => {
        const t = setup({ withoutEvents : true });
        t.observer.deliver("paint", paintEntry(500));
        t.fake.setVisibility("hidden");
        t.fake.pagehide(false);

        expect(t.recording.values("lag_web_vital_fcp_histogram")).toEqual([500]);
        expect(t.events.emit).not.toHaveBeenCalled();
    });

    it("counts the interactions of the page with performance.interactionCount", () => {
        const t = setup({ performance : { timeOrigin : 0, now : () => 0, interactionCount : 120 } });
        t.observer.deliver("event",
            eventEntry({ interactionId : 7, startTime : 1_000, duration : 600 }),
            eventEntry({ interactionId : 14, startTime : 2_000, duration : 500 }),
            eventEntry({ interactionId : 21, startTime : 3_000, duration : 400 }));
        t.fake.setVisibility("hidden");

        // With 120 interactions, INP ignores the 2 longest interactions
        expect(t.recording.values("lag_web_vital_inp_histogram")).toEqual([400]);
    });

    it("records the FCP of a restore from the animation frames, with the navigation type of the restore", () => {
        const frames : Array<(time : number) => void> = [];
        const t = setup({ requestAnimationFrame : (callback) => frames.push(callback) });
        t.fake.pagehide(true);
        t.fake.setNow(10_000);
        t.fake.pageshow(true, 10_000);
        t.fake.setNow(10_050);
        while (frames.length > 0) frames.shift()!(10_050);
        t.fake.setVisibility("hidden");

        expect(t.recording.records().get("lag_web_vital_fcp_histogram")).toEqual([{ value : 50, attributes : { navigation_type : "back-forward-cache" } }]);
    });

    it("observes soft navigations when the dependencies enable them", () => {
        const t = setup({ softNavigations : true });

        expect(t.observer.observedTypes()).toContain("soft-navigation");
    });

    it("records the vitals of each navigation type with an attribute value that the catalog permits", () => {
        const navigation = (type : "navigate" | "reload" | "back-forward", activationStart = 0) =>
            ({ type, activationStart, responseStart : 2_000, url : "https://shop.example/" });
        const softNavigation = {
            entryType : "soft-navigation",
            name : "https://shop.example/p/9",
            startTime : 3_000,
            duration : 0,
            interactionId : 77,
            presentationTime : 3_100,
        } as PerformanceEntryLike;
        const recorded = new Set<unknown>();
        const collect = (t : ReturnType<typeof setup>) => {
            t.fake.setNow(9_000);
            t.fake.setVisibility("hidden", 9_000);
            for (const { attributes } of t.recording.records().get("lag_web_vital_ttfb_histogram") ?? []) recorded.add(attributes?.["navigation_type"]);
        };

        collect(setup({ page : createFakePage({ navigation : navigation("navigate") }) }));
        collect(setup({ page : createFakePage({ navigation : navigation("reload") }) }));
        collect(setup({ page : createFakePage({ navigation : navigation("back-forward") }) }));
        collect(setup({ page : createFakePage({ navigation : navigation("navigate", 1_000) }) }));
        collect(setup({ page : createFakePage({ navigation : navigation("navigate"), wasDiscarded : true }) }));
        const restored = setup({ page : createFakePage({ navigation : navigation("navigate") }) });
        restored.fake.pagehide(true);
        restored.fake.setNow(5_000);
        restored.fake.pageshow(true, 5_000);
        collect(restored);
        const navigated = setup({ page : createFakePage({ navigation : navigation("navigate") }), softNavigations : true });
        navigated.observer.deliver("soft-navigation", softNavigation);
        collect(navigated);

        expect([...recorded].sort()).toEqual(["back-forward", "back-forward-cache", "navigate", "prerender", "reload", "restore", "soft-navigation"]);
        for (const value of recorded) expect(METRICS.vitalTtfb.attributes["navigation_type"]).toContain(value);
    });
});
