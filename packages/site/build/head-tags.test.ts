import { describe, expect, it } from "vitest";
import { breadcrumbs, headTags, jsonForScript, ogImageAlt, ogImageFile, structuredData, type SiteFacts } from "./head-tags";
import type { StaticRoute } from "./static-routes";

const SITE : SiteFacts = {
    url : "https://owner.github.io/lag/",
    name : "lag",
    softwareDescription : "The library.",
    repository : "https://github.com/owner/lag",
    license : "MIT",
    keywords : ["main thread", "INP"],
    author : { name : "Mark Russell", url : "https://github.com/owner" },
};

const HOME : StaticRoute = {
    path : "",
    title : "lag: browser main-thread lag",
    heading : "Measure the main thread",
    description : "The home.",
    kind : "home",
    section : "lag",
    crumb : "lag",
};
const DOCS : StaticRoute = { path : "docs", title : "Overview – lag", heading : "Overview", description : "The docs.", kind : "article", section : "Docs", crumb : "Docs" };
const MONITORS : StaticRoute = { path : "docs/monitors", title : "All monitors – lag", heading : "All monitors", kind : "article", section : "Monitors" };
const DRIFT : StaticRoute = {
    path : "docs/monitors/drift-lag",
    title : "DriftLag – lag",
    heading : "DriftLag",
    description : "The \"lag\" <here>.",
    kind : "article",
    section : "Monitors",
};
const PLAYGROUND : StaticRoute = { path : "playground", title : "Playground – lag", heading : "Playground", description : "Live.", kind : "page", section : "Playground", crumb : "Playground" };
const RUN : StaticRoute = { path : "results/r1/tests", title : "Tests of run r1 – lag", heading : "Tests of run r1", kind : "page", section : "Results", noindex : true };
const ROUTES = [HOME, DOCS, MONITORS, DRIFT, PLAYGROUND, RUN];

/** The JSON-LD object in the head tags. */
function jsonLd(tags : string) : unknown {
    const text = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(tags)?.[1];
    if (text === undefined) throw new Error("No JSON-LD");
    return JSON.parse(text);
}

describe("head tags", () => {
    it("gives an article its canonical URL, Open Graph, the Twitter card and the sitemap", () => {
        const tags = headTags(DRIFT, ROUTES, SITE, "Fallback.");
        const url = "https://owner.github.io/lag/docs/monitors/drift-lag";
        const image = "https://owner.github.io/lag/og/docs/monitors/drift-lag.png";
        expect(tags).toContain(`<link rel="canonical" href="${url}" />`);
        expect(tags).toContain(`<meta property="og:url" content="${url}" />`);
        expect(tags).toContain("<meta property=\"og:type\" content=\"article\" />");
        expect(tags).toContain("<meta property=\"og:site_name\" content=\"lag\" />");
        expect(tags).toContain("<meta property=\"og:title\" content=\"DriftLag\" />");
        expect(tags).toContain("<meta property=\"og:description\" content=\"The &quot;lag&quot; &lt;here&gt;.\" />");
        expect(tags).toContain(`<meta property="og:image" content="${image}" />`);
        expect(tags).toContain("<meta property=\"og:image:width\" content=\"1200\" />");
        expect(tags).toContain("<meta property=\"og:image:height\" content=\"630\" />");
        expect(tags).toMatch(/<meta property="og:image:alt" content="DriftLag, a page of the lag site\. [^"]+" \/>/);
        expect(tags).toContain("<meta property=\"article:section\" content=\"Monitors\" />");
        expect(tags).toContain("<meta name=\"twitter:card\" content=\"summary_large_image\" />");
        expect(tags).toContain(`<meta name="twitter:image" content="${image}" />`);
        expect(tags).toContain("<link rel=\"sitemap\" type=\"application/xml\" href=\"https://owner.github.io/lag/sitemap.xml\" />");
        expect(tags).not.toContain("noindex");
    });

    it("gives the home page the full title, the type website and the site URL", () => {
        const tags = headTags(HOME, ROUTES, SITE, "Fallback.");
        expect(tags).toContain("<link rel=\"canonical\" href=\"https://owner.github.io/lag/\" />");
        expect(tags).toContain("<meta property=\"og:type\" content=\"website\" />");
        expect(tags).toContain("<meta property=\"og:title\" content=\"lag: browser main-thread lag\" />");
        expect(tags).toContain("<meta property=\"og:image\" content=\"https://owner.github.io/lag/og/index.png\" />");
        expect(tags).not.toContain("article:section");
    });

    it("uses the fallback description for a page without a description", () => {
        const tags = headTags(MONITORS, ROUTES, SITE, "Fallback.");
        expect(tags).toContain("<meta property=\"og:description\" content=\"Fallback.\" />");
        expect(tags).toContain("<meta name=\"twitter:description\" content=\"Fallback.\" />");
    });

    it("tells search engines not to keep the page of a test run", () => {
        const tags = headTags(RUN, ROUTES, SITE, "Fallback.");
        expect(tags).toContain("<meta name=\"robots\" content=\"noindex\" />");
        expect(tags).toContain("<meta property=\"og:type\" content=\"website\" />");
    });

    it("gives the home page a WebSite and a SoftwareSourceCode in TypeScript under the MIT license", () => {
        expect(jsonLd(headTags(HOME, ROUTES, SITE, "Fallback."))).toEqual(structuredData(HOME, ROUTES, SITE));
        expect(structuredData(HOME, ROUTES, SITE)).toEqual({
            "@context" : "https://schema.org",
            "@graph" : [
                {
                    "@type" : "WebSite",
                    "@id" : "https://owner.github.io/lag/#website",
                    url : "https://owner.github.io/lag/",
                    name : "lag",
                    description : "The home.",
                    inLanguage : "en",
                },
                {
                    "@type" : "SoftwareSourceCode",
                    "@id" : "https://owner.github.io/lag/#software",
                    name : "lag",
                    description : "The library.",
                    url : "https://owner.github.io/lag/",
                    codeRepository : "https://github.com/owner/lag",
                    programmingLanguage : "TypeScript",
                    runtimePlatform : ["Web browsers"],
                    license : "https://opensource.org/licenses/MIT",
                    keywords : "main thread, INP",
                    author : { "@type" : "Person", name : "Mark Russell", url : "https://github.com/owner" },
                },
            ],
        });
    });

    it("gives an article a TechArticle and a BreadcrumbList", () => {
        const graph = (structuredData(DRIFT, ROUTES, SITE) as { "@graph" : Array<Record<string, unknown>> })["@graph"];
        expect(graph[0]).toMatchObject({
            "@type" : "TechArticle",
            headline : "DriftLag",
            url : "https://owner.github.io/lag/docs/monitors/drift-lag",
            image : "https://owner.github.io/lag/og/docs/monitors/drift-lag.png",
            articleSection : "Monitors",
            about : { "@type" : "SoftwareSourceCode", codeRepository : "https://github.com/owner/lag" },
        });
        expect(graph[1]).toEqual({
            "@type" : "BreadcrumbList",
            itemListElement : [
                { "@type" : "ListItem", position : 1, name : "lag", item : "https://owner.github.io/lag/" },
                { "@type" : "ListItem", position : 2, name : "Docs", item : "https://owner.github.io/lag/docs" },
                { "@type" : "ListItem", position : 3, name : "All monitors", item : "https://owner.github.io/lag/docs/monitors" },
                { "@type" : "ListItem", position : 4, name : "DriftLag", item : "https://owner.github.io/lag/docs/monitors/drift-lag" },
            ],
        });
    });

    it("gives a page of the app a WebPage", () => {
        const graph = (structuredData(PLAYGROUND, ROUTES, SITE) as { "@graph" : Array<Record<string, unknown>> })["@graph"];
        expect(graph[0]).toMatchObject({ "@type" : "WebPage", name : "Playground", url : "https://owner.github.io/lag/playground" });
        expect(graph[1]).toMatchObject({ "@type" : "BreadcrumbList", itemListElement : [{ name : "lag" }, { name : "Playground" }] });
    });

    it("puts only the parent routes that exist into the breadcrumbs", () => {
        expect(breadcrumbs(DRIFT, [HOME, DRIFT], SITE).map(crumb => crumb.path)).toEqual(["", "docs/monitors/drift-lag"]);
        expect(breadcrumbs(RUN, ROUTES, SITE).map(crumb => crumb.name)).toEqual(["lag", "Tests of run r1"]);
        expect(breadcrumbs(HOME, ROUTES, SITE)).toEqual([{ name : "lag", path : "" }]);
    });

    it("escapes the JSON so that a text cannot close the script element", () => {
        const value = "</script><script>alert(1)</script> &  ";
        const text = jsonForScript({ value });
        expect(text).not.toContain("<");
        expect(text).not.toContain(" ");
        expect(JSON.parse(text)).toEqual({ value });
    });

    it("names the image files and the text alternatives", () => {
        expect(ogImageFile(HOME)).toBe("og/index.png");
        expect(ogImageFile(DRIFT)).toBe("og/docs/monitors/drift-lag.png");
        expect(ogImageAlt(HOME, SITE)).toMatch(/^lag: Measure the main thread\. A chart of main-thread lag/);
    });
});
