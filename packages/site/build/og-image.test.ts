import { describe, expect, it } from "vitest";
import { preloadFiles } from "./font-preload-plugin";
import type { SiteFacts } from "./head-tags";
import { brandMarkSvg, lagChartSvg, lagSeries, LONG_MS, OG_COLORS, ogCard, ogImageHtml, siteAddress, unbrokenHtml, type OgCard } from "./og-image";
import { prerenderEnabled } from "./static-site-plugin";

const SITE : SiteFacts = {
    url : "https://owner.github.io/lag/",
    name : "lag",
    softwareDescription : "The library.",
    repository : "https://github.com/owner/lag",
    license : "MIT",
};

const FONTS = { sans : ["url(sans.woff2)"], mono : ["url(mono.woff2)"] };

describe("Open Graph images", () => {
    it("gives an article its group, its title and its description", () => {
        expect(ogCard({ path : "docs/monitors/drift-lag", title : "DriftLag – lag", heading : "DriftLag", description : "The lag.", kind : "article", section : "Monitors" }, SITE, "Fallback.")).toEqual({
            eyebrow : "Monitors",
            title : "DriftLag",
            description : "The lag.",
            siteName : "lag",
            address : "owner.github.io/lag",
            seed : "docs/monitors/drift-lag",
        });
        expect(ogCard({ path : "docs", title : "Overview – lag", heading : "Overview", kind : "article", section : "Docs" }, SITE, "Fallback.")).toMatchObject({
            eyebrow : "Docs",
            description : "Fallback.",
        });
    });

    it("gives the home page the language and the license of the library", () => {
        expect(ogCard({ path : "", title : "lag: x", heading : "x", kind : "home", section : "lag" }, SITE, "Fallback.").eyebrow).toBe("TypeScript library, MIT license");
    });

    it("keeps each word with a hyphen on one line, and escapes the title", () => {
        expect(unbrokenHtml("Tests of run 2026-10-06-f6e5d4c")).toBe("Tests of run <span class=\"nowrap\">2026-10-06-f6e5d4c</span>");
        expect(unbrokenHtml("Page-view <vitals>")).toBe("<span class=\"nowrap\">Page-view</span> &lt;vitals&gt;");
        expect(unbrokenHtml("DriftLag")).toBe("DriftLag");
    });

    it("gives the address of the site without the protocol", () => {
        expect(siteAddress("https://owner.github.io/lag/")).toBe("owner.github.io/lag");
        expect(siteAddress("https://example.com/")).toBe("example.com");
    });

    it("escapes the text, uses the fonts of the site and tells the build when it is ready", () => {
        const card : OgCard = {
            eyebrow : "Docs",
            title : "<b>Bold</b> & co",
            description : "1 < 2",
            siteName : "lag",
            address : "a.b/c",
            seed : "x",
        };
        const html = ogImageHtml(card, FONTS);
        expect(html).toContain("&lt;b&gt;Bold&lt;/b&gt; &amp; co");
        expect(html).toContain("1 &lt; 2");
        expect(html).toContain("@font-face{font-family:\"Atkinson Hyperlegible Next\";src:url(sans.woff2)");
        expect(html).toContain("@font-face{font-family:\"Atkinson Hyperlegible Mono\";src:url(mono.woff2)");
        expect(html).toContain("width: 1200px; height: 630px;");
        expect(html).toContain("data-ready");
        expect(html).not.toMatch(/<script[^>]+src=/);
        expect(html).not.toContain("http");
    });
});

describe("lag chart", () => {
    it("gives the same values for the same seed, and other values for another seed", () => {
        expect(lagSeries("docs/api", 26)).toEqual(lagSeries("docs/api", 26));
        expect(lagSeries("docs/api", 26)).not.toEqual(lagSeries("docs/thesis", 26));
        expect(lagSeries("x", 40)).toHaveLength(40);
    });

    it("has a few long windows and many short windows, for each seed", () => {
        for (const seed of ["", "docs", "docs/monitors/drift-lag", "research/sources", "playground", "results/r1/tests"]) {
            const values = lagSeries(seed, 26);
            const long = values.filter(value => value >= LONG_MS).length;
            expect(long, seed).toBeGreaterThanOrEqual(1);
            expect(long, seed).toBeLessThanOrEqual(4);
            expect(values.every(value => value > 0 && value <= 115), seed).toBe(true);
            expect(values.filter(value => value < 35).length, seed).toBeGreaterThanOrEqual(18);
        }
    });

    it("draws one bar for each window, red from 50 ms, the dashed line at 50 ms and the scale", () => {
        const svg = lagChartSvg([10, 60, 49.9, 50], { width : 200, height : 100, labelWidth : 40 });
        expect(svg.match(/<rect /g)).toHaveLength(4);
        expect(svg.match(new RegExp(`fill="${OG_COLORS.mark}"/>`, "g"))).toHaveLength(2);
        expect(svg).toContain("stroke-dasharray");
        expect(svg).toContain(">50 ms</text>");
        expect(lagChartSvg([10], { width : 200, height : 100, labelWidth : 0 })).not.toContain("<text");
    });

    it("draws the site mark with its red frame", () => {
        const svg = brandMarkSvg(44);
        expect(svg).toContain("height=\"44\"");
        expect(svg).toContain(`fill="${OG_COLORS.mark}"`);
        expect(svg.match(/<rect /g)).toHaveLength(5);
    });
});

describe("prerender switch", () => {
    it("is on unless SITE_PRERENDER is 0, false, no or off", () => {
        expect(prerenderEnabled(undefined)).toBe(true);
        expect(prerenderEnabled("1")).toBe(true);
        for (const value of ["0", "false", "NO", " off "]) expect(prerenderEnabled(value)).toBe(false);
    });
});

describe("font preload", () => {
    it("selects the Latin text font and the Latin code font of the bundle", () => {
        expect(preloadFiles([
            "assets/index-abc.js",
            "assets/atkinson-hyperlegible-mono-latin-wght-normal-Ab12.woff2",
            "assets/atkinson-hyperlegible-next-latin-ext-wght-normal-Cd34.woff2",
            "assets/atkinson-hyperlegible-next-latin-wght-normal-Ef56.woff2",
            "assets/atkinson-hyperlegible-next-latin-wght-italic-Gh78.woff2",
        ])).toEqual([
            "assets/atkinson-hyperlegible-next-latin-wght-normal-Ef56.woff2",
            "assets/atkinson-hyperlegible-mono-latin-wght-normal-Ab12.woff2",
        ]);
    });
});
