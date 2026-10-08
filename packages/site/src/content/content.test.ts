import { describe, expect, it } from "vitest";
import { siteContent } from "./site-content";

/** The skeleton pages that the site must have. */
const REQUIRED : Readonly<Record<string, readonly string[]>> = {
    docs : [
        "",
        "getting-started",
        "concepts/event-loop",
        "concepts/page-lifecycle",
        "concepts/measurement-validity",
        "concepts/metrics-model",
        "monitors",
        "monitors/drift-lag",
        "monitors/macrotask-lag",
        "monitors/worker-lag",
        "monitors/peer-hang-watch",
        "monitors/long-animation-frames",
        "monitors/event-timing",
        "monitors/layout-shift",
        "monitors/page-view-vitals",
        "monitors/page-view-context",
        "monitors/frame-timing",
        "monitors/idle-availability",
        "monitors/scheduling-fairness",
        "monitors/memory",
        "monitors/compute-pressure",
        "monitors/gc-signal",
        "monitors/timer-throttle",
        "monitors/clock-reliability",
        "monitors/clock-drift",
        "monitors/shared-liveness",
        "monitors/lifecycle",
        "monitors/browser-reports",
        "concepts/clocks-and-time",
        "concepts/page-views",
        "concepts/statistics",
        "concepts/survivorship",
        "architecture",
        "api",
        "operations/opentelemetry",
        "operations/grafana-stack",
        "operations/dashboards",
        "testing/strategy",
        "contributing/writing-style",
        "contributing/development",
    ],
    thesis : [""],
    research : ["", "browser-support", "clocks-and-timers", "local-experiments", "web-vitals-algorithms", "rum-landscape", "otel-browser-metrics", "writing-standard", "sources"],
};

const allPages = siteContent.sections().flatMap(section => siteContent.pages(section));

describe("site content", () => {
    it("has valid frontmatter on every page", () => {
        expect(siteContent.problems()).toEqual([]);
    });

    it("has every required page", () => {
        for (const [section, slugs] of Object.entries(REQUIRED)) {
            for (const slug of slugs) {
                expect(siteContent.page(section, slug), `${section}/${slug}`).toBeDefined();
            }
        }
    });

    it("gives each page in a section a different order", () => {
        for (const section of siteContent.sections()) {
            const orders = siteContent.pages(section).map(page => page.meta.order);
            expect(new Set(orders).size, section).toBe(orders.length);
        }
    });

    it.each(allPages.map(page => [page.path, page] as const))("compiles %s with a component and a table of contents", async (_path, page) => {
        const module = await page.load();
        expect(typeof module.default).toBe("function");
        expect(Array.isArray(module.toc)).toBe(true);
        for (const entry of module.toc ?? []) {
            expect(entry.id).toMatch(/^[a-z0-9-]+$/);
            expect([2, 3]).toContain(entry.depth);
            expect(entry.text.length).toBeGreaterThan(0);
        }
        expect(module.frontmatter).toMatchObject({ title : page.meta.title });
    });
});
