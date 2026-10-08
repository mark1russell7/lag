import { expect } from "vitest";
import { cdp } from "../commands.js";
import { nextFrames, wait, waitUntil } from "../harness.js";
import { startMonitors } from "./monitors.js";

/**
 * The hidden checkpoint of the page-view vitals. This file has its own
 * document, which was never hidden before the test: the load metrics (FCP,
 * LCP) count only before the first hidden time of the page view.
 */
describe("The page-view vitals at the hidden checkpoint", () => {
    afterEach(async () => {
        await cdp.resetPage();
    });

    it("record one value for each vital, and the events, when the page becomes hidden", async () => {
        const text = document.createElement("p");
        text.textContent = "Contentful text for FCP and LCP.";
        document.body.append(text);
        await nextFrames(3);
        const page = startMonitors();
        try {
            await wait(1_000);
            expect(page.tee.records("lag_web_vital_fcp_histogram")).toEqual([]);

            await cdp.hidePage();
            await waitUntil(() => document.visibilityState === "hidden", 2_000);
            await wait(200);
            const hiddenAt = page.transitions.find(t => t.to === "hidden")!.timestamp;

            for (const metric of ["lag_web_vital_ttfb_histogram", "lag_web_vital_fcp_histogram", "lag_web_vital_lcp_histogram", "lag_web_vital_cls_histogram"]) {
                const records = page.tee.records(metric);
                expect(records, metric).toHaveLength(1);
                expect(records[0]!.time, metric).toBeGreaterThanOrEqual(hiddenAt);
                expect(records[0]!.attributes, metric).toEqual({ navigation_type : expect.stringMatching(/^(navigate|reload)$/) });
            }
            const events = page.events.filter(e => e.name === "browser.web_vital");
            expect(events.map(e => e.attributes["browser.web_vital.name"]).sort()).toEqual(["cls", "fcp", "lcp", "ttfb"]);
            // Every event has the page view, for the join with the other events of the view
            const viewId = page.handles.vitals!.getView().id;
            for (const event of events) expect(event.attributes["lag.page_view.id"]).toBe(viewId);

            // A second hidden checkpoint does not record the same view again: a histogram cannot remove a value
            await cdp.showPage();
            await waitUntil(() => document.visibilityState === "visible", 2_000);
            await cdp.hidePage();
            await waitUntil(() => document.visibilityState === "hidden", 2_000);
            await wait(200);
            expect(page.tee.records("lag_web_vital_fcp_histogram")).toHaveLength(1);
            expect(page.events.filter(e => e.name === "browser.web_vital")).toHaveLength(events.length);
        } finally {
            page.stop();
        }
    });
});
