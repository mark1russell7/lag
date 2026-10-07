import { describe, expect, it, vi } from "vitest";
import { createInstrumentedPageViewContext } from "./page-view-context.js";
import type { PageViewVitals } from "../vitals/PageViewVitals.js";
import type { PageView } from "../vitals/ViewCollector.js";

function fakeVitals(initial : PageView) {
    const listeners = new Set<(view : PageView) => void>();
    let view = initial;
    const vitals = {
        getView : () => view,
        subscribe : (listener : (v : PageView) => void) => {
            listeners.add(listener);
            return () => { listeners.delete(listener); };
        },
    } as unknown as PageViewVitals;
    return {
        vitals,
        startView(next : PageView) {
            view = next;
            for (const listener of [...listeners]) listener(next);
        },
        listenerCount : () => listeners.size,
    };
}

const view = (id : string) : PageView => ({ id, navigationType : "navigate", startTime : 0 });
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe("createInstrumentedPageViewContext", () => {
    it("gives the current page view ID to each receiver, now and at each new view", () => {
        const fake = fakeVitals(view("view-1"));
        const receiver = { setContext : vi.fn() };
        const handle = createInstrumentedPageViewContext({ logger : { log : vi.fn() } }, fake.vitals, [receiver]);

        fake.startView(view("view-2"));

        expect(receiver.setContext.mock.calls).toEqual([
            [{ "lag.page_view.id" : "view-1" }],
            [{ "lag.page_view.id" : "view-2" }],
        ]);
        expect(handle.monitor!.getAttributes()).toEqual({ "lag.page_view.id" : "view-2" });

        handle.stop();
        expect(fake.listenerCount()).toBe(0);
    });

    it("initializes the crash-report context, sets the view ID, and deletes it on stop", async () => {
        const fake = fakeVitals(view("view-1"));
        const crashReport = { initialize : vi.fn(() => Promise.resolve()), set : vi.fn(), delete : vi.fn() };
        const handle = createInstrumentedPageViewContext({ logger : { log : vi.fn() }, crashReport }, fake.vitals, []);
        await settle();
        fake.startView(view("view-2"));
        await settle();

        expect(crashReport.initialize).toHaveBeenCalledTimes(1);
        expect(crashReport.set.mock.calls).toEqual([["lag.page_view.id", "view-1"], ["lag.page_view.id", "view-2"]]);

        handle.stop();
        await settle();
        expect(crashReport.delete).toHaveBeenCalledWith("lag.page_view.id");
    });

    it("still sets the context when an other script initialized the crash-report context first", async () => {
        const fake = fakeVitals(view("view-1"));
        const crashReport = { initialize : vi.fn(() => Promise.reject(new Error("already initialized"))), set : vi.fn() };
        createInstrumentedPageViewContext({ logger : { log : vi.fn() }, crashReport }, fake.vitals, []);
        await settle();

        expect(crashReport.set).toHaveBeenCalledWith("lag.page_view.id", "view-1");
    });

    it("logs a failure of the crash-report context at debug level and continues", async () => {
        const fake = fakeVitals(view("view-1"));
        const logger = { log : vi.fn() };
        const crashReport = { set : vi.fn(() => { throw new Error("not initialized"); }) };
        const receiver = { setContext : vi.fn() };
        createInstrumentedPageViewContext({ logger, crashReport }, fake.vitals, [receiver]);
        await settle();
        fake.startView(view("view-2"));

        expect(logger.log).toHaveBeenCalledWith("debug", "Could not set the crash-report context.", expect.anything());
        expect(receiver.setContext).toHaveBeenCalledTimes(2);
    });
});
