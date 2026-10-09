import { describe, expect, it } from "vitest";
import { LAG_SOCIAL_CARD, socialCardHtml } from "./social-card";

const FONTS = { sans : ["url(sans.woff2)"], mono : ["url(mono.woff2)"] };

describe("social preview", () => {
    it("shows the name, the claim, the facts and the chart at 1280 × 640 pixels", () => {
        const html = socialCardHtml(LAG_SOCIAL_CARD, FONTS);
        expect(html).toContain("width: 1280px; height: 640px;");
        expect(html).toContain(">lag</span>");
        expect(html).toContain("Measure how long the main thread makes users wait");
        expect(html).toContain("<span class=\"fact\">MIT license</span>");
        expect(html.match(/<rect /g)?.length).toBeGreaterThan(50);
        expect(html).toContain("data-ready");
        expect(html).not.toContain("http");
    });

    it("escapes the text", () => {
        const html = socialCardHtml({ ...LAG_SOCIAL_CARD, claim : "1 < 2 & more" }, FONTS);
        expect(html).toContain("1 &lt; 2 &amp; more");
    });
});
