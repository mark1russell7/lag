import { HOME_HEADING, LICENSE, SITE_NAME } from "../src/app/site";
import { escapeHtml } from "./static-routes";
import { brandMarkSvg, fontFaces, lagChartSvg, lagSeries, LONG_MS, OG_COLORS, type OgFonts } from "./og-image";

/** The size of the social preview of a GitHub repository. */
export const SOCIAL_CARD_WIDTH = 1280;
export const SOCIAL_CARD_HEIGHT = 640;

/** The text of the social preview of the repository. */
export type SocialCard = {
    name : string;
    claim : string;
    summary : string;
    /** The short facts at the top right, for example the language and the license. */
    facts : readonly string[];
};

/** The social preview of the lag repository. */
export const LAG_SOCIAL_CARD : SocialCard = {
    name : SITE_NAME,
    claim : HOME_HEADING,
    summary : "Main-thread lag, long tasks, hangs, INP and the Web Vitals from real browsers, as OpenTelemetry metrics.",
    facts : ["TypeScript", "OpenTelemetry", `${LICENSE} license`],
};

/**
 * The HTML page of the social preview of the repository (1280 × 640
 * pixels). It shows the name with the site mark, the claim and one line
 * about the library. Under them, a wide chart shows main-thread lag on
 * graph paper. Use `pnpm --filter @lag/site social-preview` to make the
 * PNG file again.
 */
export function socialCardHtml(card : SocialCard, fonts : OgFonts) : string {
    const c = OG_COLORS;
    const facts = card.facts.map(fact => `<span class="fact">${escapeHtml(fact)}</span>`).join("");
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
${fontFaces(fonts)}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${SOCIAL_CARD_WIDTH}px; height: ${SOCIAL_CARD_HEIGHT}px; overflow: hidden; }
body {
  display: grid;
  grid-template-rows: auto 1fr auto;
  padding: 46px 72px 0;
  background-color: ${c.page};
  background-image: linear-gradient(${c.grid} 1.5px, transparent 1.5px), linear-gradient(90deg, ${c.grid} 1.5px, transparent 1.5px);
  background-size: 32px 32px;
  background-position: -1px -1px;
  color: ${c.ink};
  font-family: "Atkinson Hyperlegible Next", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.top { display: flex; align-items: center; justify-content: space-between; }
.brand { display: flex; align-items: center; gap: 20px; font-size: 76px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; }
.facts { display: flex; gap: 10px; }
.fact { padding: 7px 14px; border: 2px solid ${c.ruleStrong}; border-radius: 6px; background: ${c.surface}; color: ${c.inkSecondary}; font-family: "Atkinson Hyperlegible Mono", monospace; font-size: 19px; font-weight: 700; }
.main { align-self: center; padding-bottom: 8px; }
.title { max-width: 1080px; font-size: 64px; font-weight: 800; line-height: 1.04; letter-spacing: -0.03em; text-wrap: balance; }
.summary { max-width: 1040px; margin-top: 18px; color: ${c.inkSecondary}; font-size: 28px; line-height: 1.35; }
.strip {
  position: relative;
  margin: 0 -72px;
  padding: 18px 72px 26px;
  border-top: 2px solid ${c.ink};
  background-color: ${c.surface};
  background-image: linear-gradient(${c.grid} 1.5px, transparent 1.5px), linear-gradient(90deg, ${c.grid} 1.5px, transparent 1.5px);
  background-size: 16px 16px;
  background-position: -1px -1px;
}
.strip svg { display: block; }
.strip-label { position: absolute; top: 14px; right: 72px; padding: 2px 0 2px 10px; background: ${c.surface}; color: ${c.inkMuted}; font-family: "Atkinson Hyperlegible Mono", monospace; font-size: 17px; }
.strip-label b { color: ${c.mark}; }
.scale { font-family: "Atkinson Hyperlegible Mono", monospace; font-size: 15px; font-weight: 700; paint-order: stroke; stroke: ${c.surface}; stroke-width: 6px; stroke-linejoin: round; }
</style>
</head>
<body>
  <div class="top">
    <div class="brand">${brandMarkSvg(68)}<span>${escapeHtml(card.name)}</span></div>
    <div class="facts">${facts}</div>
  </div>
  <div class="main">
    <h1 class="title">${escapeHtml(card.claim)}</h1>
    <p class="summary">${escapeHtml(card.summary)}</p>
  </div>
  <div class="strip">
    <p class="strip-label">100&nbsp;ms windows · <b>red</b>: ${LONG_MS}&nbsp;ms or more late</p>
    ${lagChartSvg(lagSeries("social-preview", 58), { width : SOCIAL_CARD_WIDTH - 144, height : 176, labelWidth : 70 })}
  </div>
  <script>document.fonts.ready.then(function () { document.body.setAttribute("data-ready", "true"); });</script>
</body>
</html>
`;
}
