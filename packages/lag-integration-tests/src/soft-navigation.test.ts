import { expect } from "vitest";
import { clickInTopLevelPage, recordMeasurement } from "./commands.js";
import type { SoftNavigationResult } from "./pages/soft-navigation-page.js";

/**
 * PageViewVitals with a real soft navigation. Chrome detects soft navigations
 * only in the top-level frame, and this test operates in the frame of Vitest.
 * Thus a server command opens `pages/soft-navigation.html`, clicks its button
 * with Playwright, and reads the result. The click blocks for 60 ms, changes
 * the URL, and adds the content of the next page. Chromium 145 of Playwright
 * has no soft-navigation entries. Chrome 153 has them by default.
 */
describe("PageViewVitals with a real soft navigation", () => {
    it("starts a new page view with its own LCP, and keeps the click in the INP of the first view", async (test) => {
        test.skip(!PerformanceObserver.supportedEntryTypes.includes("soft-navigation"), "This browser has no soft-navigation entries.");

        const result = await clickInTopLevelPage<SoftNavigationResult>("src/pages/soft-navigation.html", "#go", 2_000, "window.finishProbe()");
        const of = (view : string | undefined, name : string) => result.vitals.find(v => v["lag.page_view.id"] === view && v["browser.web_vital.name"] === name);
        const views = [...new Set(result.vitals.map(v => v["lag.page_view.id"] as string))];
        const [first, second] = views;
        console.log(`Entries in the sequence of delivery: ${result.entryOrder.join(", ")}. ` +
            `INP of the first view ${String(of(first, "inp")?.["browser.web_vital.value"])} ms, LCP of the second view ${String(of(second, "lcp")?.["browser.web_vital.value"])} ms`);

        expect(views).toHaveLength(2);
        expect(of(first, "lcp")?.["browser.web_vital.navigation_type"]).toBe("navigate");
        // The click that started the soft navigation is in the INP of the first view, as the navigationId of its entries says
        const inp = of(first, "inp");
        expect(inp?.["browser.web_vital.value"]).toBeGreaterThanOrEqual(56);
        expect(inp?.["lag.web_vital.interaction_target"]).toBe("#go");
        expect(of(second, "inp")).toBeUndefined();
        // The second view gets its LCP from the interaction-contentful-paint entry, from the start of the navigation
        const lcp = of(second, "lcp");
        expect(lcp?.["browser.web_vital.navigation_type"]).toBe("soft-navigation");
        expect(lcp?.["browser.web_vital.value"]).toBeGreaterThan(0);
        expect(lcp?.["browser.web_vital.value"]).toBeLessThan(1_000);
        expect(String(lcp?.["lag.web_vital.target"])).toContain("main");
        expect(of(second, "ttfb")?.["browser.web_vital.value"]).toBe(0);
        expect(String(lcp?.["lag.page_view.url"])).toMatch(/\/src\/pages\/next-page$/);
        expect(result.url).toMatch(/\/src\/pages\/next-page$/);

        await recordMeasurement("soft-navigation/first-view/inp", "ms", [inp?.["browser.web_vital.value"] as number]);
        await recordMeasurement("soft-navigation/second-view/lcp", "ms", [lcp?.["browser.web_vital.value"] as number]);
    }, 30_000);
});
