import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { colorRules, colorTokens, pageHtml, replaceTokenColors, type Snapshot } from "./snapshot";
import type { StaticRoute } from "./static-routes";

const TEMPLATE = `<!doctype html>
<html lang="en">
    <head>
        <meta name="description" content="The site." />
        <title>lag</title>
        <link rel="stylesheet" crossorigin href="/base/assets/index.css">
    </head>
    <body>
        <div id="root"></div>
    </body>
</html>`;

const ROUTE : StaticRoute = { path : "docs/api", title : "API reference – lag", heading : "API reference", description : "Each export.", kind : "article", section : "Docs" };
const TOKENS : Array<[string, string]> = [
    ["#c2301f", "--color-mark"],
    ["#ffffff", "--color-surface"],
    ["#2a78d6", "--series-1"],
];

describe("color tokens", () => {
    it("reads the colors of the light theme, and leaves out a color that two tokens have", () => {
        const css = ":root {\n  --a: #C2301F;\n  --b: #fff;\n  --c: #111111;\n  --d: #111111;\n  --font: \"x\";\n}\n:root[data-theme=\"dark\"] { --a: #ff7b6b; }";
        expect(colorTokens(css)).toEqual([
            ["#c2301f", "--a"],
            ["#ffffff", "--b"],
        ]);
    });

    it("finds each color of styles/tokens.css one time, with the ink, the mark and the series colors", async () => {
        const tokens = colorTokens(await readFile(new URL("../src/styles/tokens.css", import.meta.url), "utf8"));
        expect(tokens).toContainEqual(["#151c2e", "--color-ink"]);
        expect(tokens).toContainEqual(["#c2301f", "--color-mark"]);
        expect(tokens).toContainEqual(["#2a78d6", "--series-1"]);
        expect(new Set(tokens.map(([color]) => color)).size).toBe(tokens.length);
    });

    it("replaces hex and rgb() colors of tokens, and nothing else", () => {
        expect(replaceTokenColors("stroke: rgb(194, 48, 31); fill: #FFF", TOKENS)).toBe("stroke: var(--color-mark); fill: var(--color-surface)");
        expect(replaceTokenColors("color:rgb(42 120 214);background:#2a78d6", TOKENS)).toBe("color:var(--series-1);background:var(--series-1)");
        expect(replaceTokenColors("fill: #123456; stroke: url(#ffffff); color: #c2301f80", TOKENS)).toBe("fill: #123456; stroke: url(#ffffff); color: #c2301f80");
    });

    it("works with no outside value, thus the prerender can start it in the browser", () => {
        const copy = new Function(`return (${replaceTokenColors.toString()})`)() as typeof replaceTokenColors;
        expect(copy("fill: #c2301f", TOKENS)).toBe("fill: var(--color-mark)");
    });

    it("makes CSS rules with no specificity for the SVG attributes with a token color", () => {
        expect(colorRules([
            ["fill", "#c2301f"],
            ["stroke", "rgb(42, 120, 214)"],
            ["fill", "#123456"],
            ["stroke", "var(--color-ink)"],
            ["d", "#c2301f"],
        ], TOKENS)).toEqual([
            ":where([data-prerendered] [fill=\"#c2301f\"]){fill:var(--color-mark)}",
            ":where([data-prerendered] [stroke=\"rgb(42, 120, 214)\"]){stroke:var(--series-1)}",
        ]);
    });
});

describe("page HTML", () => {
    const snapshot : Snapshot = {
        body : "<main><h1>API</h1><p>Costs $1, $& and $' are text.</p></main>",
        links : [
            "<link rel=\"stylesheet\" crossorigin href=\"/base/assets/index.css\">",
            "<link rel=\"stylesheet\" crossorigin=\"\" href=\"/base/assets/ContentPage.css\">",
            "<link rel=\"modulepreload\" as=\"script\" crossorigin=\"\" href=\"/base/assets/ContentPage.js\">",
            "<link rel=\"stylesheet\" crossorigin=\"\" href=\"/base/assets/ContentPage.css\">",
        ],
        colorAttributes : [["fill", "#c2301f"]],
    };

    it("puts the head tags after the title, and keeps the root element empty without a snapshot", () => {
        const html = pageHtml(TEMPLATE, { route : ROUTE, head : "        <link rel=\"canonical\" href=\"x\" />" });
        expect(html).toContain("<title>API reference – lag</title>\n        <link rel=\"canonical\" href=\"x\" />");
        expect(html).toContain("<meta name=\"description\" content=\"Each export.\" />");
        expect(html).toContain("<div id=\"root\"></div>");
        expect(html).not.toContain("data-prerender");
    });

    it("puts the snapshot into the root element, with the route, and the text stays as it is", () => {
        const html = pageHtml(TEMPLATE, { route : ROUTE, head : "", snapshot, tokens : TOKENS });
        expect(html).toContain("<div id=\"root\" data-prerendered=\"docs/api\"><main><h1>API</h1><p>Costs $1, $& and $' are text.</p></main></div>");
    });

    it("adds the style sheets of the page one time each, after the style sheet of the template", () => {
        const html = pageHtml(TEMPLATE, { route : ROUTE, head : "", snapshot, tokens : TOKENS });
        expect(html.match(/index\.css/g)).toHaveLength(1);
        expect(html.match(/ContentPage\.css/g)).toHaveLength(1);
        expect(html.indexOf("index.css")).toBeLessThan(html.indexOf("ContentPage.css"));
        expect(html.indexOf("ContentPage.js")).toBeLessThan(html.indexOf("</head>"));
    });

    it("adds the color rules before the style sheets, thus the other rules win", () => {
        const html = pageHtml(TEMPLATE, { route : ROUTE, head : "", snapshot, tokens : TOKENS });
        expect(html).toContain(":where([data-prerendered] [fill=\"#c2301f\"]){fill:var(--color-mark)}");
        expect(html).toContain("[data-theme-toggle]{visibility:hidden}");
        expect(html.indexOf("<style data-prerender>")).toBeLessThan(html.indexOf("index.css"));
    });

    it("refuses a template without an empty root element", () => {
        expect(() => pageHtml(TEMPLATE.replace("<div id=\"root\"></div>", "<div id=\"app\"></div>"), { route : ROUTE, head : "" })).toThrow(/<div id="root"><\/div>/);
    });
});
