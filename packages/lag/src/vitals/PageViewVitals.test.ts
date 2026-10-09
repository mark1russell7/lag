import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { PageViewVitals, type VitalsReport } from "./PageViewVitals.js";
import {
    createFakeLifecycle,
    createFakePage,
    createFakePerformanceObserver,
    eventEntry,
    lcpEntry,
    paintEntry,
    shiftEntry,
    type FakePage,
} from "./test-fakes.js";
import type { PerformanceEntryLike } from "../perf-types.js";

const ALL_TYPES = ["event", "first-input", "layout-shift", "paint", "largest-contentful-paint", "soft-navigation", "interaction-contentful-paint"];

function setup(options : {
    page? : FakePage | undefined;
    visibility? : "visible" | "hidden";
    supported? : readonly string[] | undefined;
    softNavigations? : boolean;
    interactionCount? : () => number;
    describeNode? : (node : unknown) => string;
    /** The entries in the buffer of the browser before the start, and whether `observe()` delivers them at once (old Safari). */
    buffered? : { entries : Record<string, PerformanceEntryLike[]>; synchronous : boolean };
} = {}) {
    const fake = createFakeLifecycle(options.visibility ?? "visible");
    const observer = createFakePerformanceObserver("supported" in options ? options.supported : ALL_TYPES, { synchronousBuffer : options.buffered?.synchronous === true });
    for (const [type, entries] of Object.entries(options.buffered?.entries ?? {})) observer.buffer(type, ...entries);
    const reports : VitalsReport[] = [];
    const frames : Array<() => void> = [];
    const logger = { log : vi.fn() };
    let ids = 0;
    const page = "page" in options ? options.page : createFakePage();
    const report = vi.fn((r : VitalsReport) => { reports.push(r); });
    const vitals = new PageViewVitals(report, {
        logger,
        clock : fake.clock,
        PerformanceObserver : observer.PerformanceObserver,
        lifecycle : fake.lifecycle,
        ...(page ? { page } : {}),
        requestAnimationFrame : (callback) => { frames.push(() => callback(fake.clock.now())); return frames.length; },
        inputTarget : fake.window,
        describeNode : options.describeNode ?? ((node) => `#${(node as { id : string }).id}`),
        createId : () => `view-${++ids}`,
        ...(options.softNavigations !== undefined ? { softNavigations : options.softNavigations } : {}),
        ...(options.interactionCount ? { readInteractionCount : options.interactionCount } : {}),
    });
    return {
        ...fake,
        observer,
        vitals,
        reports,
        report,
        logger,
        page,
        /** This function starts the animation frames that wait. */
        runFrames() {
            const waiting = frames.splice(0);
            for (const frame of waiting) frame();
        },
    };
}

const valuesOf = (report : VitalsReport | undefined) =>
    Object.fromEntries((report?.values ?? []).map(v => [v.name, v.value]));

function softNavigation(fields : {
    startTime : number;
    interactionId : number;
    url : string;
    presentationTime? : number;
    largest? : PerformanceEntryLike;
}) : PerformanceEntryLike {
    return {
        entryType : "soft-navigation",
        name : fields.url,
        startTime : fields.startTime,
        duration : 0,
        interactionId : fields.interactionId,
        presentationTime : fields.presentationTime ?? 0,
        getLargestInteractionContentfulPaint : () => fields.largest ?? null,
    } as PerformanceEntryLike;
}

function contentfulPaint(interactionId : number, startTime : number, renderTime : number, id? : string) : PerformanceEntryLike {
    return {
        entryType : "interaction-contentful-paint",
        name : "",
        startTime,
        duration : 0,
        interactionId,
        largestContentfulPaint : { renderTime, ...(id ? { element : { id } } : {}) },
    } as PerformanceEntryLike;
}

describe("PageViewVitals", () => {
    describe("a load", () => {
        it("reports TTFB, FCP, LCP, INP and CLS when the page becomes hidden", () => {
            const t = setup();
            t.observer.deliver("layout-shift", shiftEntry(300, 0.05));
            t.observer.deliver("paint", paintEntry(500));
            t.observer.deliver("largest-contentful-paint", lcpEntry(800, { id : "hero" }, "https://cdn.example/hero.jpg?sig=abc"));
            t.observer.deliver("layout-shift", shiftEntry(900, 0.3, true));
            t.observer.deliver("event", eventEntry({ interactionId : 7, startTime : 1_000, duration : 120 }));
            t.setNow(5_000);
            t.setVisibility("hidden");

            expect(t.reports).toHaveLength(1);
            const [report] = t.reports;
            expect(report!.final).toBe(false);
            expect(report!.view).toEqual({ id : "view-1", navigationType : "navigate", startTime : 0, url : "https://shop.example/cart" });
            expect(valuesOf(report)).toEqual({ TTFB : 200, FCP : 500, LCP : 800, INP : 120, CLS : 0.05 });
            expect(report!.values.find(v => v.name === "LCP")!.attribution).toEqual({ target : "#hero", url : "https://cdn.example/hero.jpg" });
        });

        it("keeps the last LCP candidate of the browser, also when its start time (the load time) is earlier", () => {
            const t = setup();
            t.observer.deliver("paint", paintEntry(400));
            // A text candidate paints at 1000 ms. Then a larger image without Timing-Allow-Origin
            // in an older browser: its render time is 0, thus its start time is the load time (800 ms).
            t.observer.queue("largest-contentful-paint", lcpEntry(1_000, { id : "headline" }), lcpEntry(800, { id : "hero" }));
            t.setNow(5_000);
            t.setVisibility("hidden", 5_000);

            const last = t.reports.at(-1)!;
            expect(valuesOf(last)).toMatchObject({ LCP : 800 });
            expect(last.values.find(v => v.name === "LCP")!.attribution).toMatchObject({ target : "#hero" });
        });

        it("makes the LCP final at a click that gives no Event Timing entry, as the DOM listener of web-vitals does", () => {
            const t = setup();
            t.observer.deliver("largest-contentful-paint", lcpEntry(700, { id : "headline" }));
            // A fast click (less than 16 ms) gives no event entry, only the DOM event
            t.setNow(1_100);
            t.window.dispatch("click", { isTrusted : true, timeStamp : 1_000 });
            t.observer.deliver("largest-contentful-paint", lcpEntry(1_600, { id : "late" }));
            t.setVisibility("hidden", 5_000);

            expect(valuesOf(t.reports.at(-1))).toMatchObject({ LCP : 700 });
        });

        it("makes the LCP final at a key press that gives no Event Timing entry", () => {
            const t = setup();
            t.observer.deliver("largest-contentful-paint", lcpEntry(700, { id : "headline" }));
            t.setNow(1_100);
            t.window.dispatch("keydown", { isTrusted : true, timeStamp : 1_000 });
            t.observer.deliver("largest-contentful-paint", lcpEntry(1_600, { id : "late" }));
            t.setVisibility("hidden", 5_000);

            expect(valuesOf(t.reports.at(-1))).toMatchObject({ LCP : 700 });
        });

        it("ignores a synthetic click (isTrusted false), and removes its listeners at stop()", () => {
            const t = setup();
            t.observer.deliver("largest-contentful-paint", lcpEntry(700));
            t.setNow(1_100);
            t.window.dispatch("click", { isTrusted : false, timeStamp : 1_000 });
            t.observer.deliver("largest-contentful-paint", lcpEntry(1_600));
            t.setVisibility("hidden", 5_000);
            expect(valuesOf(t.reports.at(-1))).toMatchObject({ LCP : 1_600 });

            t.vitals.stop();
            expect(t.window.listeners().filter(l => l.type === "click" || l.type === "keydown")).toEqual([]);
        });

        it("ignores the LCP candidates that paint after the first click or key press, as web-vitals does", () => {
            const t = setup();
            t.observer.deliver("largest-contentful-paint", lcpEntry(700, { id : "headline" }));
            t.observer.deliver("event", eventEntry({ interactionId : 4, startTime : 1_000, duration : 40, name : "click" }));
            t.observer.deliver("largest-contentful-paint", lcpEntry(1_600, { id : "late" }));
            t.setVisibility("hidden", 5_000);

            expect(valuesOf(t.reports.at(-1))).toMatchObject({ LCP : 700 });
        });

        it("counts the interactions of the load from the start of the page, also when the monitors start later", () => {
            // 100 interactions occurred before the start. The buffer gives the entries of the long ones.
            let count = 100;
            const t = setup({ interactionCount : () => count });
            t.observer.deliver("event",
                eventEntry({ interactionId : 7, startTime : 1_000, duration : 600 }),
                eventEntry({ interactionId : 14, startTime : 2_000, duration : 500 }),
                eventEntry({ interactionId : 21, startTime : 3_000, duration : 400 }));
            count = 110;
            t.setVisibility("hidden", 5_000);

            // The index is min(2, floor(110 / 50)) = 2: the third-longest interaction
            expect(valuesOf(t.reports.at(-1))).toMatchObject({ INP : 400 });
        });

        it("observes the event entries with the smallest threshold that browsers permit", () => {
            const t = setup();
            expect(t.observer.optionsOf("event")).toMatchObject({ durationThreshold : 16, buffered : true });
        });

        it("reports the final values when the page terminates", () => {
            const t = setup();
            t.observer.deliver("paint", paintEntry(500));
            t.pagehide(false);

            expect(t.reports.at(-1)!.final).toBe(true);
            expect(valuesOf(t.reports.at(-1))).toMatchObject({ FCP : 500 });
        });

        it("ignores the paints after the page was hidden for the first time", () => {
            const t = setup();
            // The clock is after the times of the events, thus the events give their times
            t.setNow(2_000);
            t.setVisibility("hidden", 300);
            t.setVisibility("visible", 400);
            t.observer.deliver("paint", paintEntry(500));
            t.observer.deliver("largest-contentful-paint", lcpEntry(600));
            t.setVisibility("hidden", 2_000);

            expect(valuesOf(t.reports.at(-1))).toEqual({ TTFB : 200 });
        });

        it("takes the first hidden time from the visibility-state entries", () => {
            const t = setup({ page : createFakePage({ hiddenTimes : [100] }) });
            t.observer.deliver("paint", paintEntry(500));
            t.setVisibility("hidden");

            expect(valuesOf(t.reports.at(-1))).not.toHaveProperty("FCP");
        });

        it("thinks that a page that is hidden at the start was hidden from the start", () => {
            const t = setup({ visibility : "hidden" });
            t.observer.deliver("paint", paintEntry(500));
            t.observer.deliver("largest-contentful-paint", lcpEntry(600));
            t.pagehide(false);

            expect(valuesOf(t.reports.at(-1))).toEqual({ TTFB : 200 });
        });

        it("uses the navigation type restore for a page that the browser discarded", () => {
            const t = setup({ page : createFakePage({ wasDiscarded : true }) });
            expect(t.vitals.getView().navigationType).toBe("restore");
        });

        it("uses navigate and gives no TTFB without a navigation entry", () => {
            const t = setup({ page : createFakePage({ navigation : undefined }) });
            t.observer.deliver("paint", paintEntry(500));
            t.setVisibility("hidden");

            expect(t.vitals.getView().navigationType).toBe("navigate");
            expect(valuesOf(t.reports.at(-1))).toEqual({ FCP : 500, CLS : 0 });
        });

        it("works without a page source", () => {
            const t = setup({ page : undefined });
            t.observer.deliver("paint", paintEntry(500));
            t.setVisibility("hidden");

            expect(valuesOf(t.reports.at(-1))).toEqual({ FCP : 500, CLS : 0 });
        });

        it.each([false, true])("gets the buffered FCP and layout shifts, also when observe() delivers them at once (old Safari: %s)", async (synchronous) => {
            const t = setup({ buffered : { entries : { "paint" : [paintEntry(500)], "layout-shift" : [shiftEntry(600, 0.2)] }, synchronous } });
            await Promise.resolve();
            t.setNow(1_000);
            t.setVisibility("hidden");

            expect(valuesOf(t.reports.at(-1))).toMatchObject({ FCP : 500, CLS : 0.2 });
            expect(t.logger.log).not.toHaveBeenCalled();
            t.vitals.stop();
            expect(t.observer.observedTypes()).toEqual([]);
        });

        it("makes no report at a checkpoint when there are no values", () => {
            const t = setup({ page : undefined });
            t.setVisibility("hidden");
            expect(t.reports).toEqual([]);
        });
    });

    describe("a prerendered page", () => {
        it("starts at the activation and measures the load metrics from the activation", () => {
            const page = createFakePage({ prerendering : true, navigation : { type : "navigate", activationStart : 0, responseStart : 300, url : "https://shop.example/" } });
            const t = setup({ page, visibility : "hidden" });
            expect(t.vitals.getView().navigationType).toBe("prerender");
            expect(t.observer.observedTypes()).toEqual([]);

            // A lifecycle change before the activation is not a checkpoint
            t.document.dispatch("freeze");
            t.document.dispatch("resume");
            expect(t.reports).toEqual([]);

            page.setNavigation({ type : "navigate", activationStart : 1_000, responseStart : 300, url : "https://shop.example/" });
            t.setVisibility("visible", 1_000);
            page.activate();
            expect(t.observer.observedTypes()).toContain("paint");

            t.observer.deliver("paint", paintEntry(400));
            t.observer.deliver("largest-contentful-paint", lcpEntry(1_500));
            t.setVisibility("hidden", 3_000);

            expect(valuesOf(t.reports.at(-1))).toEqual({ TTFB : 0, FCP : 0, LCP : 500, CLS : 0 });
        });
    });

    describe("a restore from the back/forward cache", () => {
        it("ends the view and starts a new one, with TTFB 0 and paint times from two animation frames", () => {
            const t = setup();
            t.observer.deliver("event", eventEntry({ interactionId : 1, startTime : 100, duration : 80 }));
            t.pagehide(true);
            t.setNow(10_040);
            t.pageshow(true, 10_000);

            const ended = t.reports.at(-1)!;
            expect(ended.view.id).toBe("view-1");
            expect(ended.final).toBe(true);
            expect(valuesOf(ended)).toMatchObject({ INP : 80 });

            const view = t.vitals.getView();
            expect(view).toEqual({ id : "view-2", navigationType : "back-forward-cache", startTime : 10_000, url : "https://shop.example/cart" });

            t.runFrames();
            t.setNow(10_060);
            t.runFrames();
            // An interaction from before the restore does not count
            t.observer.deliver("event", eventEntry({ interactionId : 1, startTime : 100, duration : 300 }));
            t.setVisibility("hidden", 20_000);

            expect(t.reports.at(-1)!.view.id).toBe("view-2");
            expect(valuesOf(t.reports.at(-1))).toEqual({ TTFB : 0, FCP : 60, LCP : 60, CLS : 0 });
        });

        // Chromium (WebViewImpl::SetPageLifecycleStateInternal) stores a page with pagehide,
        // visibilitychange and freeze, and it restores the page with resume, visibilitychange and pageshow.
        it("starts a new view with the event sequence of Chromium, in which the page is visible before pageshow", () => {
            const t = setup();
            t.observer.deliver("event", eventEntry({ interactionId : 1, startTime : 100, duration : 80 }));
            t.pagehide(true);
            t.setVisibility("hidden", 1_000);
            t.document.dispatch("freeze", {});

            t.setNow(10_040);
            t.document.dispatch("resume", { timeStamp : 10_000 });
            t.setVisibility("visible", 10_000);
            t.pageshow(true, 10_000);
            expect(t.vitals.getView()).toMatchObject({ id : "view-2", navigationType : "back-forward-cache", startTime : 10_000 });

            t.observer.deliver("event", eventEntry({ interactionId : 9, startTime : 12_000, duration : 400 }));
            t.setVisibility("hidden", 20_000);
            const last = t.reports.at(-1)!;
            expect(last.view.id).toBe("view-2");
            expect(valuesOf(last)).toMatchObject({ INP : 400 });
            // The load view ends at the restore, with one final report
            const load = t.reports.filter(r => r.view.id === "view-1");
            expect(load.at(-1)!.final).toBe(true);
            expect(load.filter(r => r.final)).toHaveLength(1);
        });

        it("gives an INP of 8 ms when there were interactions after the restore but no entries", () => {
            let count = 0;
            const t = setup({ interactionCount : () => count });
            t.pagehide(true);
            t.pageshow(true, 5_000);
            count = 2;
            t.setVisibility("hidden", 9_000);

            expect(valuesOf(t.reports.at(-1))).toMatchObject({ INP : 8 });
        });
    });

    describe("soft navigations", () => {
        it("are off by default, as in web-vitals", () => {
            const t = setup();
            expect(t.observer.observedTypes()).not.toContain("soft-navigation");
        });

        it("start a new view with TTFB 0, FCP from the presentation time and LCP from the interaction paints", () => {
            const t = setup({ softNavigations : true });
            t.observer.deliver("event", eventEntry({ interactionId : 77, startTime : 3_000, duration : 48 }));
            t.observer.deliver("soft-navigation", softNavigation({
                startTime : 3_000,
                interactionId : 77,
                url : "https://shop.example/product/9?ref=mail",
                presentationTime : 3_100,
                largest : contentfulPaint(77, 3_000, 3_400, "photo"),
            }));

            const ended = t.reports.at(-1)!;
            expect(ended).toMatchObject({ final : true, view : { id : "view-1" } });
            // The interaction that started the navigation counts for the previous view, as in web-vitals
            expect(valuesOf(ended)).toMatchObject({ INP : 48 });

            expect(t.vitals.getView()).toEqual({
                id : "view-2",
                navigationType : "soft-navigation",
                startTime : 3_000,
                interactionId : 77,
                url : "https://shop.example/product/9",
            });

            t.observer.deliver("interaction-contentful-paint", contentfulPaint(12, 3_000, 9_000));
            t.observer.deliver("interaction-contentful-paint", contentfulPaint(77, 3_000, 3_700, "gallery"));
            t.setVisibility("hidden", 8_000);

            const report = t.reports.at(-1)!;
            expect(valuesOf(report)).toEqual({ TTFB : 0, FCP : 100, LCP : 700, CLS : 0 });
            expect(report.values.find(v => v.name === "LCP")!.attribution).toEqual({ target : "#gallery" });
        });

        it("gives the paints that the browser did not deliver yet to the new view, after the largest paint of the entry", () => {
            const t = setup({ softNavigations : true });
            t.observer.deliver("paint", paintEntry(500));
            // One delivery of the browser: the soft-navigation observer runs first. The other observers
            // still hold the entries of the next frame.
            t.observer.queue("layout-shift", shiftEntry(3_150, 0.3));
            t.observer.queue("interaction-contentful-paint", contentfulPaint(77, 3_000, 3_400, "gallery"));
            t.observer.deliver("soft-navigation", softNavigation({
                startTime : 3_000,
                interactionId : 77,
                url : "https://shop.example/p/9",
                presentationTime : 3_100,
                largest : contentfulPaint(77, 3_000, 3_100, "title"),
            }));
            t.setVisibility("hidden", 8_000);

            const first = t.reports.filter(r => r.view.id === "view-1").at(-1);
            const second = t.reports.filter(r => r.view.id === "view-2").at(-1);
            expect(valuesOf(first)).toMatchObject({ CLS : 0 });
            expect(valuesOf(second)).toMatchObject({ CLS : 0.3, LCP : 400 });
            expect(second!.values.find(v => v.name === "LCP")!.attribution).toEqual({ target : "#gallery" });
        });

        it("gives an interaction after the start of the soft navigation to the new view, also when its observer did not deliver it yet", () => {
            const t = setup({ softNavigations : true });
            t.observer.queue("event", eventEntry({ interactionId : 90, startTime : 3_500, duration : 300 }));
            t.observer.deliver("soft-navigation", softNavigation({ startTime : 3_000, interactionId : 77, url : "https://shop.example/p/9" }));
            t.setVisibility("hidden", 8_000);

            expect(valuesOf(t.reports.filter(r => r.view.id === "view-1").at(-1))).not.toHaveProperty("INP");
            expect(valuesOf(t.reports.filter(r => r.view.id === "view-2").at(-1))).toMatchObject({ INP : 300 });
        });

        it("keeps an entry that the browser delivered before the soft-navigation entry in the earlier view, also when it starts later, as web-vitals does", () => {
            const t = setup({ softNavigations : true });
            t.observer.deliver("event", eventEntry({ interactionId : 90, startTime : 3_500, duration : 300 }));
            t.observer.deliver("soft-navigation", softNavigation({ startTime : 3_000, interactionId : 77, url : "https://shop.example/p/9" }));
            t.setVisibility("hidden", 8_000);

            expect(valuesOf(t.reports.filter(r => r.view.id === "view-1").at(-1))).toMatchObject({ INP : 300 });
            expect(valuesOf(t.reports.filter(r => r.view.id === "view-2").at(-1))).not.toHaveProperty("INP");
        });

        it("ignores the paints of the navigation after the next click, as web-vitals makes the LCP final at the next input", () => {
            const t = setup({ softNavigations : true });
            t.observer.deliver("soft-navigation", softNavigation({
                startTime : 3_000,
                interactionId : 77,
                url : "https://shop.example/p/9",
                presentationTime : 3_100,
                largest : contentfulPaint(77, 3_000, 3_400, "title"),
            }));
            t.observer.deliver("event", eventEntry({ interactionId : 80, startTime : 6_000, duration : 40, name : "click" }));
            // A late image of the navigation paints after the click
            t.observer.deliver("interaction-contentful-paint", contentfulPaint(77, 3_000, 9_000, "late-image"));
            t.setVisibility("hidden", 12_000);

            expect(valuesOf(t.reports.filter(r => r.view.id === "view-2").at(-1))).toMatchObject({ LCP : 400 });
        });

        it("need the soft-navigation and interaction-contentful-paint entry types", () => {
            const t = setup({ softNavigations : true, supported : ["event", "paint", "soft-navigation"] });
            expect(t.observer.observedTypes()).toEqual(["event", "paint"]);
        });
    });

    describe("checkpoints", () => {
        it("process the entries that the browser has not delivered yet", () => {
            const t = setup();
            t.observer.queue("event", eventEntry({ interactionId : 3, startTime : 900, duration : 200 }));
            t.setVisibility("hidden");

            expect(valuesOf(t.reports.at(-1))).toMatchObject({ INP : 200 });
        });

        it("split the pending entries at a pending soft navigation, in the sequence of their start times", () => {
            const t = setup({ softNavigations : true });
            t.observer.queue("event",
                eventEntry({ interactionId : 1, startTime : 2_000, duration : 64 }),
                eventEntry({ interactionId : 2, startTime : 3_500, duration : 96 }));
            t.observer.queue("soft-navigation", softNavigation({ startTime : 3_000, interactionId : 1, url : "https://shop.example/b" }));
            t.setVisibility("hidden", 4_000);

            const first = t.reports.find(r => r.view.id === "view-1")!;
            const second = t.reports.find(r => r.view.id === "view-2")!;
            expect(first.final).toBe(true);
            expect(valuesOf(first)).toMatchObject({ INP : 64 });
            expect(valuesOf(second)).toMatchObject({ INP : 96 });
        });

        it("log an error from the report function and continue", () => {
            const t = setup();
            t.report.mockImplementationOnce(() => { throw new Error("export failed"); });
            t.observer.deliver("paint", paintEntry(500));
            t.setVisibility("hidden");
            t.setVisibility("visible");
            t.setVisibility("hidden");

            expect(t.logger.log).toHaveBeenCalledWith("error", "Error reporting page-view vitals.", { error : expect.any(Error), type : "PageViewVitals" });
            expect(t.reports).toHaveLength(1);
        });
    });

    describe("subscribe()", () => {
        it("calls the listener at each new view, until the listener is removed", () => {
            const t = setup();
            const listener = vi.fn();
            const remove = t.vitals.subscribe(listener);
            t.pagehide(true);
            t.pageshow(true, 5_000);
            remove();
            t.pagehide(true);
            t.pageshow(true, 9_000);

            expect(listener.mock.calls).toEqual([[expect.objectContaining({ id : "view-2", navigationType : "back-forward-cache" })]]);
        });

        it("logs an error from a listener and continues", () => {
            const t = setup();
            const second = vi.fn();
            t.vitals.subscribe(() => { throw new Error("boom"); });
            t.vitals.subscribe(second);
            t.pagehide(true);
            t.pageshow(true, 5_000);

            expect(t.logger.log).toHaveBeenCalledWith("error", "Error in a page-view listener.", { error : expect.any(Error), type : "PageViewVitals" });
            expect(second).toHaveBeenCalled();
        });
    });

    describe("flush()", () => {
        it("reports the current values now, as a checkpoint that is not final", () => {
            const t = setup();
            t.observer.queue("paint", paintEntry(500));
            t.vitals.flush();

            expect(t.reports).toEqual([expect.objectContaining({ final : false })]);
            expect(valuesOf(t.reports[0])).toMatchObject({ FCP : 500 });
        });

        it("does nothing before the activation of a prerendered page or after stop()", () => {
            const t = setup({ page : createFakePage({ prerendering : true }) });
            t.vitals.flush();
            expect(t.reports).toEqual([]);

            const s = setup();
            s.vitals.stop();
            const count = s.reports.length;
            s.vitals.flush();
            expect(s.reports).toHaveLength(count);
        });
    });

    describe("stop()", () => {
        it("reports the final values, stops the observers and ignores later changes", () => {
            const t = setup();
            t.observer.deliver("paint", paintEntry(500));
            t.vitals.stop();

            expect(t.reports.at(-1)!.final).toBe(true);
            expect(t.observer.observedTypes()).toEqual([]);
            t.setVisibility("hidden");
            t.vitals.stop();
            expect(t.reports).toHaveLength(1);
        });

        it("gives no value for a vital whose entry type the browser does not have, as web-vitals", () => {
            // Firefox has no layout-shift entries. Safari before 26.2 also has no event entries.
            const t = setup({ supported : ["paint", "largest-contentful-paint"] });
            t.observer.deliver("paint", paintEntry(500));
            t.observer.deliver("largest-contentful-paint", lcpEntry(800));
            t.setVisibility("hidden", 2_000);
            expect(valuesOf(t.reports.at(-1))).toEqual({ TTFB : 200, FCP : 500, LCP : 800 });

            // Also not after a restore from the back/forward cache
            t.pagehide(true);
            t.pageshow(true, 10_000);
            t.runFrames();
            t.runFrames();
            t.setVisibility("hidden", 12_000);
            expect(Object.keys(valuesOf(t.reports.at(-1))).sort()).toEqual(["FCP", "LCP", "TTFB"]);
        });

        it("makes no observer for an entry type that the browser does not have, and no warning", () => {
            const t = setup({ supported : ["event", "paint", "largest-contentful-paint"] });
            expect(t.observer.observedTypes()).toEqual(["event", "paint", "largest-contentful-paint"]);
            expect(t.logger.log).not.toHaveBeenCalled();
        });
    });

    describe("view IDs", () => {
        beforeEach(() => {
            vi.useFakeTimers();
            vi.setSystemTime(1_700_000_000_000);
        });

        afterEach(() => {
            vi.useRealTimers();
            vi.restoreAllMocks();
        });

        it("makes an ID of the form lag-<time>-<13 random digits> without an ID function, and a new ID for each view", () => {
            vi.spyOn(Math, "random").mockReturnValueOnce(0.1).mockReturnValueOnce(0.2);
            const fake = createFakeLifecycle();
            const vitals = new PageViewVitals(() => {}, {
                logger : { log : vi.fn() },
                clock : fake.clock,
                PerformanceObserver : createFakePerformanceObserver(ALL_TYPES).PerformanceObserver,
                lifecycle : fake.lifecycle,
            });
            const load = vitals.getView().id;
            fake.pagehide(true);
            fake.pageshow(true, 5_000);
            const restore = vitals.getView().id;

            expect(load).toMatch(/^lag-1700000000000-\d{13}$/);
            expect(restore).toMatch(/^lag-1700000000000-\d{13}$/);
            expect(restore).not.toBe(load);
        });
    });

    describe("rules of the load metrics", () => {
        it("uses the describeNode function of the dependencies for the attribution", () => {
            const t = setup({ describeNode : (node) => `node:${(node as { id : string }).id}` });
            t.observer.deliver("largest-contentful-paint", lcpEntry(800, { id : "hero" }));
            t.setVisibility("hidden", 2_000);

            expect(t.reports.at(-1)!.values.find(v => v.name === "LCP")!.attribution).toEqual({ target : "node:hero" });
        });

        it("describes a node with the selector of web-vitals when the dependencies have no describeNode function", () => {
            const fake = createFakeLifecycle();
            const observer = createFakePerformanceObserver(ALL_TYPES);
            const reports : VitalsReport[] = [];
            new PageViewVitals((report) => reports.push(report), {
                logger : { log : vi.fn() },
                clock : fake.clock,
                PerformanceObserver : observer.PerformanceObserver,
                lifecycle : fake.lifecycle,
            });
            const body = { nodeType : 1, nodeName : "BODY", classList : [], parentNode : { nodeType : 9, nodeName : "#document" } };
            observer.deliver("largest-contentful-paint", lcpEntry(800, { nodeType : 1, nodeName : "IMG", classList : ["hero"], parentNode : body }));
            fake.setVisibility("hidden", 2_000);

            expect(reports.at(-1)!.values.find(v => v.name === "LCP")!.attribution).toEqual({ target : "body>img.hero" });
        });

        it("ignores a first-paint entry: only first-contentful-paint gives FCP", () => {
            const t = setup();
            t.observer.deliver("paint", { entryType : "paint", name : "first-paint", startTime : 300, duration : 0 });
            t.observer.deliver("paint", paintEntry(500));
            t.setVisibility("hidden", 2_000);

            expect(valuesOf(t.reports.at(-1))).toMatchObject({ FCP : 500 });
        });

        it("ignores a paint at the time at which the page became hidden, as web-vitals does", () => {
            const t = setup();
            t.setNow(600);
            t.setVisibility("hidden", 500);
            t.setVisibility("visible", 600);
            t.observer.deliver("paint", paintEntry(500));
            t.observer.deliver("largest-contentful-paint", lcpEntry(500));
            t.setVisibility("hidden", 2_000);

            expect(valuesOf(t.reports.at(-1))).toEqual({ TTFB : 200 });
        });

        it("keeps the first hidden time when the page becomes hidden again", () => {
            const t = setup();
            t.setNow(2_000);
            t.setVisibility("hidden", 300);
            t.setVisibility("visible", 400);
            // The browser did not deliver this paint before the second checkpoint
            t.observer.queue("paint", paintEntry(500));
            t.setVisibility("hidden", 2_000);

            expect(valuesOf(t.reports.at(-1))).not.toHaveProperty("FCP");
        });

        it("takes the earliest hidden time of the visibility-state entries", () => {
            const t = setup({ page : createFakePage({ hiddenTimes : [300, 100] }) });
            t.observer.deliver("paint", paintEntry(200));
            t.setVisibility("hidden", 5_000);

            expect(valuesOf(t.reports.at(-1))).not.toHaveProperty("FCP");
        });

        it("thinks that a page that is hidden at the start was hidden from the start, also without a page source", () => {
            const t = setup({ page : undefined, visibility : "hidden" });
            t.observer.deliver("paint", paintEntry(500));
            t.pagehide(false);

            expect(valuesOf(t.reports.at(-1))).toEqual({});
        });

        it("ignores the hidden times before the activation of a prerendered page", () => {
            const page = createFakePage({ prerendering : true, hiddenTimes : [100] });
            const t = setup({ page, visibility : "hidden" });
            page.setNavigation({ type : "navigate", activationStart : 1_000, responseStart : 300, url : "https://shop.example/" });
            t.setVisibility("visible", 1_000);
            page.activate();
            t.observer.deliver("paint", paintEntry(1_400));
            t.setVisibility("hidden", 3_000);

            expect(valuesOf(t.reports.at(-1))).toMatchObject({ FCP : 400 });
        });

        it("counts a hidden time at the activation of a prerendered page, as web-vitals does", () => {
            const page = createFakePage({ prerendering : true, hiddenTimes : [1_000] });
            const t = setup({ page, visibility : "hidden" });
            page.setNavigation({ type : "navigate", activationStart : 1_000, responseStart : 300, url : "https://shop.example/" });
            t.setVisibility("visible", 1_000);
            page.activate();
            t.observer.deliver("paint", paintEntry(1_400));
            t.setVisibility("hidden", 3_000);

            expect(valuesOf(t.reports.at(-1))).not.toHaveProperty("FCP");
        });

        it("uses the navigation type prerender for a page that the browser activated before the monitors started", () => {
            const t = setup({ page : createFakePage({ navigation : { type : "navigate", activationStart : 1_000, responseStart : 300, url : "https://shop.example/" } }) });
            t.setVisibility("hidden", 2_000);

            expect(t.vitals.getView().navigationType).toBe("prerender");
            expect(valuesOf(t.reports.at(-1))).toMatchObject({ TTFB : 0 });
        });

        it("makes the LCP final at a key press", () => {
            const t = setup();
            t.observer.deliver("largest-contentful-paint", lcpEntry(700));
            t.observer.deliver("event", eventEntry({ interactionId : 4, startTime : 1_000, duration : 40, name : "keydown" }));
            t.observer.deliver("largest-contentful-paint", lcpEntry(1_600));
            t.setVisibility("hidden", 5_000);

            expect(valuesOf(t.reports.at(-1))).toMatchObject({ LCP : 700 });
        });

        it("does not make the LCP final at a pointer event without a click", () => {
            const t = setup();
            t.observer.deliver("largest-contentful-paint", lcpEntry(700));
            t.observer.deliver("event", eventEntry({ interactionId : 4, startTime : 1_000, duration : 40, name : "pointerdown" }));
            t.observer.deliver("largest-contentful-paint", lcpEntry(1_600));
            t.setVisibility("hidden", 5_000);

            expect(valuesOf(t.reports.at(-1))).toMatchObject({ LCP : 1_600 });
        });

        it("processes the entries that the other observers did not deliver yet before a later entry", () => {
            const t = setup();
            t.observer.deliver("largest-contentful-paint", lcpEntry(700));
            // The click is earlier than the next LCP candidate, but its observer did not deliver it yet
            t.observer.queue("event", eventEntry({ interactionId : 4, startTime : 1_000, duration : 40, name : "click" }));
            t.observer.deliver("largest-contentful-paint", lcpEntry(1_600));
            t.setVisibility("hidden", 5_000);

            expect(valuesOf(t.reports.at(-1))).toMatchObject({ LCP : 700 });
        });

        it("counts the first input for INP, also when the event entries do not contain it", () => {
            const t = setup();
            t.observer.deliver("first-input", { ...eventEntry({ interactionId : 3, startTime : 1_000, duration : 8 }), entryType : "first-input" });
            t.setVisibility("hidden", 2_000);

            expect(valuesOf(t.reports.at(-1))).toMatchObject({ INP : 8 });
        });

        it("gives FCP and LCP entries only to the load: a restored view gets these values from the animation frames", () => {
            const t = setup();
            t.pagehide(true);
            t.setNow(10_040);
            t.pageshow(true, 10_000);
            t.observer.deliver("paint", paintEntry(12_000));
            t.runFrames();
            t.runFrames();
            t.observer.deliver("largest-contentful-paint", lcpEntry(12_500));
            t.setVisibility("hidden", 20_000);

            expect(valuesOf(t.reports.at(-1))).toMatchObject({ FCP : 40, LCP : 40 });
        });
    });

    describe("rules of soft navigations", () => {
        it("observes no soft navigations when the browser gives no list of supported entry types", () => {
            const t = setup({ softNavigations : true, supported : undefined });

            expect(t.observer.observedTypes()).toEqual(["event", "first-input", "layout-shift", "paint", "largest-contentful-paint"]);
        });

        it("does not make the LCP final at the interaction that started the soft navigation", () => {
            const t = setup({ softNavigations : true });
            t.observer.deliver("soft-navigation", softNavigation({ startTime : 3_000, interactionId : 77, url : "https://shop.example/p/9", presentationTime : 3_100 }));
            // The click of the navigation arrives after the soft-navigation entry
            t.observer.deliver("event", eventEntry({ interactionId : 77, startTime : 3_000, duration : 48, name : "click" }));
            t.observer.deliver("interaction-contentful-paint", contentfulPaint(77, 3_000, 3_400, "photo"));
            t.setVisibility("hidden", 8_000);

            expect(valuesOf(t.reports.filter(r => r.view.id === "view-2").at(-1))).toMatchObject({ LCP : 400 });
        });

        it("does not make the LCP of a soft navigation final at an input at the start time of the navigation", () => {
            const t = setup({ softNavigations : true });
            t.observer.deliver("soft-navigation", softNavigation({ startTime : 3_000, interactionId : 77, url : "https://shop.example/p/9", presentationTime : 3_100 }));
            t.setNow(3_200);
            t.window.dispatch("click", { isTrusted : true, timeStamp : 3_000 });
            t.observer.deliver("interaction-contentful-paint", contentfulPaint(77, 3_000, 3_400, "photo"));
            t.setVisibility("hidden", 8_000);

            expect(valuesOf(t.reports.filter(r => r.view.id === "view-2").at(-1))).toMatchObject({ LCP : 400 });
        });

        it("ignores the paints of other interactions, also when they come last", () => {
            const t = setup({ softNavigations : true });
            t.observer.deliver("soft-navigation", softNavigation({ startTime : 3_000, interactionId : 77, url : "https://shop.example/p/9", presentationTime : 3_100 }));
            t.observer.deliver("interaction-contentful-paint", contentfulPaint(77, 3_000, 3_400, "photo"));
            t.observer.deliver("interaction-contentful-paint", contentfulPaint(12, 3_000, 9_000, "banner"));
            t.setVisibility("hidden", 12_000);

            expect(valuesOf(t.reports.filter(r => r.view.id === "view-2").at(-1))).toMatchObject({ LCP : 400 });
        });

        it("counts an interaction paint without an interaction ID for the current soft navigation", () => {
            const t = setup({ softNavigations : true });
            t.observer.deliver("soft-navigation", softNavigation({ startTime : 3_000, interactionId : 77, url : "https://shop.example/p/9", presentationTime : 3_100 }));
            const paint = { entryType : "interaction-contentful-paint", name : "", startTime : 3_000, duration : 0, largestContentfulPaint : { renderTime : 3_400 } } as PerformanceEntryLike;
            t.observer.deliver("interaction-contentful-paint", paint);
            t.setVisibility("hidden", 8_000);

            expect(valuesOf(t.reports.filter(r => r.view.id === "view-2").at(-1))).toMatchObject({ LCP : 400 });
        });

        it("ignores an interaction paint before the first soft navigation", () => {
            const t = setup({ softNavigations : true });
            t.observer.deliver("largest-contentful-paint", lcpEntry(700));
            const paint = { entryType : "interaction-contentful-paint", name : "", startTime : 1_000, duration : 0, largestContentfulPaint : { renderTime : 1_500 } } as PerformanceEntryLike;
            t.observer.deliver("interaction-contentful-paint", paint);
            t.setVisibility("hidden", 2_000);

            expect(valuesOf(t.reports.at(-1))).toMatchObject({ LCP : 700 });
        });

        it("ignores an interaction paint at or after the time at which the page became hidden", () => {
            const t = setup({ softNavigations : true });
            t.observer.deliver("soft-navigation", softNavigation({ startTime : 3_000, interactionId : 77, url : "https://shop.example/p/9", presentationTime : 3_100 }));
            t.setNow(5_500);
            t.setVisibility("hidden", 5_000);
            t.setVisibility("visible", 5_500);
            t.observer.deliver("interaction-contentful-paint", contentfulPaint(77, 3_000, 5_000, "photo"));
            t.setVisibility("hidden", 8_000);

            expect(valuesOf(t.reports.filter(r => r.view.id === "view-2").at(-1))).not.toHaveProperty("LCP");
        });

        it("starts a view for an entry without a largest paint, and logs no error", () => {
            const t = setup({ softNavigations : true });
            const withoutMethod = { entryType : "soft-navigation", name : "https://shop.example/p/9", startTime : 3_000, duration : 0, interactionId : 77, presentationTime : 3_100 } as PerformanceEntryLike;
            t.observer.deliver("soft-navigation", withoutMethod);
            t.observer.deliver("soft-navigation", softNavigation({ startTime : 5_000, interactionId : 78, url : "https://shop.example/p/10", presentationTime : 5_050 }));
            t.setVisibility("hidden", 8_000);

            expect(t.logger.log).not.toHaveBeenCalled();
            expect(valuesOf(t.reports.filter(r => r.view.id === "view-2").at(-1))).toEqual({ TTFB : 0, FCP : 100, CLS : 0 });
            expect(valuesOf(t.reports.filter(r => r.view.id === "view-3").at(-1))).toEqual({ TTFB : 0, FCP : 50, CLS : 0 });
        });

        it("logs no error for an interaction paint without a paint", () => {
            const t = setup({ softNavigations : true });
            t.observer.deliver("soft-navigation", softNavigation({ startTime : 3_000, interactionId : 77, url : "https://shop.example/p/9", presentationTime : 3_100 }));
            const paint = { entryType : "interaction-contentful-paint", name : "", startTime : 3_000, duration : 0, interactionId : 77, largestContentfulPaint : null } as PerformanceEntryLike;
            t.observer.deliver("interaction-contentful-paint", paint);

            expect(t.logger.log).not.toHaveBeenCalled();
        });

        it("does not take the paint times of a soft navigation from the animation frames", () => {
            const t = setup({ softNavigations : true });
            t.observer.deliver("soft-navigation", softNavigation({
                startTime : 3_000,
                interactionId : 77,
                url : "https://shop.example/p/9",
                presentationTime : 3_100,
                largest : contentfulPaint(77, 3_000, 3_400),
            }));
            t.setNow(3_500);
            t.runFrames();
            t.runFrames();
            t.setVisibility("hidden", 8_000);

            expect(valuesOf(t.reports.filter(r => r.view.id === "view-2").at(-1))).toMatchObject({ FCP : 100, LCP : 400 });
        });
    });

    describe("rules of restores and of the end of a view", () => {
        it("gives no TTFB to a restored view when the load had no navigation entry", () => {
            const t = setup({ page : createFakePage({ navigation : undefined }) });
            t.pagehide(true);
            t.pageshow(true, 5_000);
            t.setVisibility("hidden", 9_000);

            expect(valuesOf(t.reports.at(-1))).toEqual({ CLS : 0 });
        });

        it("gives the pending entries before a restore to the view that ends, and the other entries to the new view", () => {
            const t = setup();
            t.pagehide(true);
            t.observer.queue("event",
                eventEntry({ interactionId : 1, startTime : 4_000, duration : 80 }),
                eventEntry({ interactionId : 2, startTime : 5_000, duration : 300 }),
                eventEntry({ interactionId : 3, startTime : 6_000, duration : 200 }));
            t.setNow(6_500);
            t.pageshow(true, 5_000);
            t.setVisibility("hidden", 9_000);

            expect(valuesOf(t.reports.filter(r => r.view.id === "view-1").at(-1))).toMatchObject({ INP : 80 });
            expect(valuesOf(t.reports.filter(r => r.view.id === "view-2").at(-1))).toMatchObject({ INP : 300 });
        });

        it("gives a restored view no URL when the load had no URL", () => {
            const t = setup({ page : undefined });
            t.pagehide(true);
            t.setNow(5_000);
            t.pageshow(true, 5_000);

            expect(t.vitals.getView()).toStrictEqual({ id : "view-2", navigationType : "back-forward-cache", startTime : 5_000 });
        });

        it("makes no report when a prerendered page terminates before the activation", () => {
            const t = setup({ page : createFakePage({ prerendering : true }), visibility : "hidden" });
            t.pagehide(false);

            expect(t.reports).toEqual([]);
        });

        it("makes no report after the final report of a view, also at a later lifecycle event", () => {
            const t = setup();
            t.observer.deliver("paint", paintEntry(500));
            t.pagehide(false);
            const count = t.reports.length;
            t.document.dispatch("freeze", {});
            t.document.dispatch("resume", {});

            expect(t.reports).toHaveLength(count);
        });

        it("observes each entry type one time, also when the page source reports the activation two times", () => {
            const page = createFakePage({ prerendering : true });
            const t = setup({ page, visibility : "hidden" });
            page.activate();
            page.activate();

            expect(t.observer.observedTypes()).toEqual(["event", "first-input", "layout-shift", "paint", "largest-contentful-paint"]);
        });

        it("stop() removes its activation listener from the page source", () => {
            const removeListener = vi.fn();
            const page : FakePage = { ...createFakePage({ prerendering : true }), onActivation : () => removeListener };
            const t = setup({ page, visibility : "hidden" });
            t.vitals.stop();

            expect(removeListener).toHaveBeenCalledTimes(1);
        });
    });
});
