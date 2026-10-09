import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOME_HEADING, HOME_TITLE } from "../src/app/site";
import {
    appRoutes,
    contentRoutes,
    homeRoute,
    NOT_FOUND_TITLE,
    notFoundHtml,
    resultsRoutes,
    routeFiles,
    routeHtml,
    sectionLabel,
    siteRoutes,
    type StaticRoute,
} from "./static-routes";

const TEMPLATE = "<!doctype html><html><head><meta name=\"description\" content=\"The site &amp; more.\" /><title>lag: browser main-thread lag</title></head><body><div id=\"root\"></div></body></html>";

const siteDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

async function contentDir() : Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "lag-routes-"));
    await mkdir(path.join(dir, "docs", "monitors"), { recursive : true });
    await mkdir(path.join(dir, "thesis"), { recursive : true });
    await writeFile(path.join(dir, "docs", "index.mdx"), "---\ntitle: Overview\ndescription: The start.\n---\nText");
    await writeFile(path.join(dir, "docs", "monitors", "drift-lag.mdx"), "---\ntitle: DriftLag \n---\nText");
    await writeFile(path.join(dir, "docs", "monitors", "index.mdx"), "---\ntitle: All monitors\n---\nText");
    await writeFile(path.join(dir, "docs", "getting-started.mdx"), "---\ntitle: Quick start\nstatus: draft\n---\nText");
    await writeFile(path.join(dir, "thesis", "index.mdx"), "---\ntitle: Thesis\n---\nText");
    return dir;
}

function route(fields : Partial<StaticRoute> & { path : string }) : StaticRoute {
    return { title : "T", heading : "T", kind : "page", section : "S", ...fields };
}

describe("static routes", () => {
    it("gives the content pages the paths, titles and groups of the content registry, in path order", async () => {
        expect(await contentRoutes(await contentDir())).toEqual([
            { path : "docs", title : "Overview – lag", heading : "Overview", description : "The start.", kind : "article", section : "Docs", crumb : "Docs" },
            { path : "docs/getting-started", title : "Quick start – lag", heading : "Quick start", kind : "article", section : "Docs" },
            { path : "docs/monitors", title : "All monitors – lag", heading : "All monitors", kind : "article", section : "Monitors" },
            { path : "docs/monitors/drift-lag", title : "DriftLag – lag", heading : "DriftLag", kind : "article", section : "Monitors" },
            { path : "thesis", title : "Thesis – lag", heading : "Thesis", kind : "article", section : "Thesis", crumb : "Thesis" },
        ]);
    });

    it("gives the views of each run, with a unique title, and ignores an unsafe run ID", () => {
        const routes = resultsRoutes({ runs : [{ id : "2026-10-08-030051-6cc5ff9" }, { id : "../x" }, { id : 3 }] });
        expect(routes.map(r => r.path)).toEqual([
            "results/2026-10-08-030051-6cc5ff9",
            "results/2026-10-08-030051-6cc5ff9/tests",
            "results/2026-10-08-030051-6cc5ff9/coverage",
            "results/2026-10-08-030051-6cc5ff9/mutation",
            "results/2026-10-08-030051-6cc5ff9/budgets",
            "results/2026-10-08-030051-6cc5ff9/measurements",
        ]);
        expect(routes[0]?.title).toBe("Run 2026-10-08-030051-6cc5ff9 – lag");
        expect(routes[1]?.title).toBe("Tests of run 2026-10-08-030051-6cc5ff9 – lag");
        expect(new Set(routes.map(r => r.title)).size).toBe(routes.length);
        expect(routes.every(r => r.noindex === true && r.kind === "page" && r.description?.startsWith("Test run 2026-10-08-030051-6cc5ff9 of lag: "))).toBe(true);
        expect(resultsRoutes(null)).toEqual([]);
        expect(resultsRoutes({ runs : "no" })).toEqual([]);
    });

    it("gives the playground and the list of runs a title and a description", () => {
        const routes = appRoutes();
        expect(routes.map(r => [r.path, r.title, r.crumb])).toEqual([
            ["playground", "Playground – lag", "Playground"],
            ["results", "Test results – lag", "Results"],
        ]);
        for (const r of routes) expect(r.description?.length ?? 0).toBeGreaterThan(100);
    });

    it("takes the home route from the title and the description of index.html", () => {
        expect(homeRoute(TEMPLATE)).toEqual({
            path : "",
            title : "lag: browser main-thread lag",
            heading : HOME_HEADING,
            description : "The site & more.",
            kind : "home",
            section : "lag",
            crumb : "lag",
        });
    });

    it("lists the home page first, then the content pages, the app pages and the runs", async () => {
        const routes = await siteRoutes(TEMPLATE, await contentDir(), { runs : [{ id : "r1" }] });
        expect(routes.map(r => r.path)).toEqual([
            "",
            "docs",
            "docs/getting-started",
            "docs/monitors",
            "docs/monitors/drift-lag",
            "thesis",
            "playground",
            "results",
            "results/r1",
            "results/r1/tests",
            "results/r1/coverage",
            "results/r1/mutation",
            "results/r1/budgets",
            "results/r1/measurements",
        ]);
    });

    it("has the title of the home page in index.html", async () => {
        const template = await readFile(path.join(siteDir, "index.html"), "utf8");
        expect(homeRoute(template).title).toBe(HOME_TITLE);
        expect(homeRoute(template).description?.length ?? 0).toBeLessThanOrEqual(160);
    });

    it("gives each page of the site a unique title and a description of a useful length", async () => {
        const template = await readFile(path.join(siteDir, "index.html"), "utf8");
        const routes = await siteRoutes(template, path.join(siteDir, "content"), null);
        expect(routes.length).toBeGreaterThanOrEqual(50);
        expect(new Set(routes.map(r => r.title)).size).toBe(routes.length);
        for (const r of routes) {
            expect(r.description, r.path).toBeTypeOf("string");
            expect(r.description?.length ?? 0, r.path).toBeGreaterThanOrEqual(70);
            // Search engines show approximately 160 characters. A longer description must still start with the main point.
            expect(r.description?.length ?? 0, r.path).toBeLessThanOrEqual(200);
        }
    });

    it("puts the title and the description of the route into the HTML, with escapes", () => {
        const html = routeHtml(TEMPLATE, route({ path : "x", title : "A <b> & \"c\" – lag", description : "Why 1 < 2 costs $1 and $&" }));
        expect(html).toContain("<title>A &lt;b&gt; &amp; &quot;c&quot; – lag</title>");
        expect(html).toContain("<meta name=\"description\" content=\"Why 1 &lt; 2 costs $1 and $&amp;\" />");
        expect(html).toContain("<div id=\"root\"></div>");
        expect(routeHtml(TEMPLATE, route({ path : "x" }))).toContain("content=\"The site &amp; more.\"");
    });

    it("gives the 404 page its title and noindex, and no description", () => {
        const html = notFoundHtml(TEMPLATE);
        expect(html).toContain(`<title>${NOT_FOUND_TITLE}</title>`);
        expect(NOT_FOUND_TITLE).toBe("Page not found – lag");
        expect(html).toContain("<meta name=\"robots\" content=\"noindex\" />");
        expect(html).not.toContain("name=\"description\"");
    });

    it("writes a file for the path and a file for the path with a slash at the end", () => {
        expect(routeFiles({ path : "docs/monitors" })).toEqual(["docs/monitors.html", "docs/monitors/index.html"]);
        expect(routeFiles({ path : "" })).toEqual(["index.html"]);
    });

    it("names the sections as the navigation does", () => {
        expect(sectionLabel("docs")).toBe("Docs");
        expect(sectionLabel("getting-started")).toBe("Getting started");
        expect(sectionLabel("")).toBe("");
    });
});
