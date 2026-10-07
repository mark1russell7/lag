import { describe, it, expect, vi } from "vitest";
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
    supported? : readonly string[];
    softNavigations? : boolean;
    interactionCount? : () => number;
} = {}) {
    const fake = createFakeLifecycle(options.visibility ?? "visible");
    const observer = createFakePerformanceObserver(options.supported ?? ALL_TYPES);
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
        describeNode : (node) => `#${(node as { id : string }).id}`,
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
        /** Starts the animation frames that are waiting. */
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

            expect(t.logger.log).toHaveBeenCalledWith("error", "Error reporting page-view vitals.", expect.anything());
            expect(t.reports).toHaveLength(1);
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

        it("makes no observer for an entry type that the browser does not have, and no warning", () => {
            const t = setup({ supported : ["event", "paint", "largest-contentful-paint"] });
            expect(t.observer.observedTypes()).toEqual(["event", "paint", "largest-contentful-paint"]);
            expect(t.logger.log).not.toHaveBeenCalled();
        });
    });
});
