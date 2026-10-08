import { describe, it, expect, vi } from "vitest";
import { createPageSource, type PageDocument, type PagePerformance } from "./page-source.js";
import type { PerformanceEntryLike } from "../perf-types.js";
import { createFakeEventTarget } from "../vitals/test-fakes.js";

function setup(entries : Record<string, PerformanceEntryLike[]> = {}, document : Partial<PageDocument> = {}, now = 10_000) {
    const target = createFakeEventTarget();
    const performance : PagePerformance = {
        now : () => now,
        getEntriesByType : (type) => entries[type] ?? [],
    };
    const doc : PageDocument = { ...target, ...document };
    return { source : createPageSource(doc, performance), target };
}

function navigationEntry(fields : Record<string, unknown>) : PerformanceEntryLike {
    return { entryType : "navigation", name : "https://shop.example/", startTime : 0, duration : 0, ...fields } as PerformanceEntryLike;
}

describe("createPageSource", () => {
    it("gives the navigation entry, with web-vitals navigation types", () => {
        for (const [type, expected] of [["navigate", "navigate"], ["reload", "reload"], ["back_forward", "back-forward"], ["prerender", "prerender"], ["unknown", "navigate"]]) {
            const { source } = setup({ navigation : [navigationEntry({ type, responseStart : 120, activationStart : 30 })] });
            expect(source.navigation()).toEqual({ type : expected, activationStart : 30, responseStart : 120, url : "https://shop.example/" });
        }
    });

    it("uses 0 when the entry has no activationStart", () => {
        const { source } = setup({ navigation : [navigationEntry({ type : "navigate", responseStart : 120 })] });
        expect(source.navigation()!.activationStart).toBe(0);
    });

    it("ignores an entry with a responseStart that is 0, missing, or not before now", () => {
        for (const responseStart of [0, -5, undefined, 10_000, 20_000]) {
            const { source } = setup({ navigation : [navigationEntry({ type : "navigate", responseStart })] });
            expect(source.navigation(), String(responseStart)).toBeUndefined();
        }
    });

    it("gives no entry when the browser has no getEntriesByType or the call fails", () => {
        const target = createFakeEventTarget();
        expect(createPageSource(target, { now : () => 1 }).navigation()).toBeUndefined();
        const failing = createPageSource(target, { now : () => 1, getEntriesByType : () => { throw new Error("no"); } });
        expect(failing.navigation()).toBeUndefined();
        expect(failing.hiddenTimes()).toEqual([]);
    });

    it("gives the start times of the hidden visibility-state entries", () => {
        const { source } = setup({
            "visibility-state" : [
                { entryType : "visibility-state", name : "visible", startTime : 0, duration : 0 },
                { entryType : "visibility-state", name : "hidden", startTime : 450, duration : 0 },
                { entryType : "visibility-state", name : "hidden", startTime : 900, duration : 0 },
            ],
        });
        expect(source.hiddenTimes()).toEqual([450, 900]);
    });

    it("reads the prerender and discard state of the document", () => {
        expect(setup({}, { prerendering : true, wasDiscarded : true }).source.isPrerendering()).toBe(true);
        expect(setup({}, { prerendering : true, wasDiscarded : true }).source.wasDiscarded()).toBe(true);
        expect(setup().source.isPrerendering()).toBe(false);
        expect(setup().source.wasDiscarded()).toBe(false);
    });

    it("listens to prerenderingchange in the capture phase, and the return value removes the listener", () => {
        const { source, target } = setup();
        const listener = vi.fn();
        const remove = source.onActivation(listener);

        expect(target.listeners()).toEqual([expect.objectContaining({ type : "prerenderingchange", capture : true })]);
        target.dispatch("prerenderingchange");
        expect(listener).toHaveBeenCalledTimes(1);

        remove();
        expect(target.listeners()).toEqual([]);
    });
});
