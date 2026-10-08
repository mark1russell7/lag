import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { contentRoutes, resultsRoutes, routeFiles, routeHtml } from "./static-routes";

const TEMPLATE = `<!doctype html><html><head><meta name="description" content="The site." /><title>lag: main-thread responsiveness</title></head><body><div id="root"></div></body></html>`;

describe("static routes", () => {
    it("gives the content pages the paths and the titles of the content registry", async () => {
        const dir = await mkdtemp(path.join(tmpdir(), "lag-routes-"));
        await mkdir(path.join(dir, "docs", "monitors"), { recursive : true });
        await writeFile(path.join(dir, "docs", "index.mdx"), "---\ntitle: Overview\ndescription: The start.\n---\nText");
        await writeFile(path.join(dir, "docs", "monitors", "drift-lag.mdx"), "---\ntitle: DriftLag\n---\nText");
        await writeFile(path.join(dir, "docs", "monitors", "index.mdx"), "---\ntitle: Monitors\n---\nText");

        const routes = (await contentRoutes(dir)).sort((a, b) => a.path.localeCompare(b.path));
        expect(routes).toEqual([
            { path : "docs", title : "Overview – lag", description : "The start." },
            { path : "docs/monitors", title : "Monitors – lag" },
            { path : "docs/monitors/drift-lag", title : "DriftLag – lag" },
        ]);
    });

    it("gives the results list and the views of each run, and ignores an unsafe run ID", () => {
        const routes = resultsRoutes({ runs : [{ id : "2026-10-08-030051-6cc5ff9" }, { id : "../x" }] });
        expect(routes.map(r => r.path)).toEqual([
            "results",
            "results/2026-10-08-030051-6cc5ff9",
            "results/2026-10-08-030051-6cc5ff9/tests",
            "results/2026-10-08-030051-6cc5ff9/coverage",
            "results/2026-10-08-030051-6cc5ff9/mutation",
            "results/2026-10-08-030051-6cc5ff9/budgets",
            "results/2026-10-08-030051-6cc5ff9/measurements",
        ]);
        expect(resultsRoutes(null).map(r => r.path)).toEqual(["results"]);
    });

    it("puts the title and the description of the route into the HTML, with escapes", () => {
        const html = routeHtml(TEMPLATE, { path : "x", title : "A <b> & \"c\" – lag", description : "Why 1 < 2" });
        expect(html).toContain("<title>A &lt;b&gt; &amp; &quot;c&quot; – lag</title>");
        expect(html).toContain('<meta name="description" content="Why 1 &lt; 2" />');
        expect(html).toContain('<div id="root"></div>');
        expect(routeHtml(TEMPLATE, { path : "x", title : "T" })).toContain('content="The site."');
    });

    it("writes a file for the path and a file for the path with a slash at the end", () => {
        expect(routeFiles({ path : "docs/monitors", title : "M" })).toEqual(["docs/monitors.html", "docs/monitors/index.html"]);
        expect(routeFiles({ path : "", title : "Home" })).toEqual([]);
    });
});
