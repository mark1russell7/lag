import { LICENSE } from "../src/app/site";
import { OG_IMAGE_HEIGHT, OG_IMAGE_WIDTH, type SiteFacts } from "./head-tags";
import { escapeHtml, type StaticRoute } from "./static-routes";

/** The text of one Open Graph image. */
export type OgCard = {
    /** The line above the title, for example "Monitors". */
    eyebrow : string;
    title : string;
    description : string;
    siteName : string;
    /** The site address without the protocol, for example "owner.github.io/lag". */
    address : string;
    /** The text that selects the bars of the chart. Each page gets its own chart. */
    seed : string;
};

/** The web fonts of the image, as `src` values of `@font-face`. */
export type OgFonts = {
    sans : readonly string[];
    mono : readonly string[];
};

/** The light theme colors of `src/styles/tokens.css`. */
export const OG_COLORS = {
    page : "#f5f6f9",
    surface : "#ffffff",
    ink : "#151c2e",
    inkSecondary : "#454f67",
    inkMuted : "#5f6880",
    rule : "#d6dbe5",
    ruleStrong : "#aeb6c7",
    grid : "#e7eaf1",
    accent : "#2346c4",
    mark : "#c2301f",
    markWash : "#fbe9e6",
    chartAxis : "#9aa1b3",
} as const;

export type OgColors = typeof OG_COLORS;

/** The lag of a window that the chart shows in red: a window that ended this late or later, in ms. The site uses the same limit. */
export const LONG_MS = 50;

/** The top of the chart scale, in ms. */
const SCALE_MS = 120;

/** A 32-bit FNV-1a hash of a text. */
function hashText(text : string) : number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

/** A small random number generator (mulberry32). The same seed gives the same numbers. */
function randomFrom(seed : number) : () => number {
    let state = seed;
    return () => {
        state = (state + 0x6d2b79f5) | 0;
        let value = Math.imul(state ^ (state >>> 15), 1 | state);
        value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * The lag of `count` windows of 100 ms, in ms, for the chart of an image.
 * Most windows have a small lag. Two to four windows have a lag of 55 ms or
 * more: a long task blocked the main thread. The same seed gives the same
 * values. Thus each page has its own chart, and the chart does not change
 * from one build to the next.
 */
export function lagSeries(seed : string, count : number) : number[] {
    const random = randomFrom(hashText(seed));
    const values = Array.from({ length : count }, () => 2 + random() * 12 + (random() < 0.2 ? random() * 18 : 0));
    const blocks = 2 + Math.floor(random() * 3);
    for (let block = 0; block < blocks; block += 1) {
        const at = Math.min(count - 1, Math.floor(count * (0.12 + 0.8 * random())));
        values[at] = 55 + random() * 60;
        // A long task can make the next window late too.
        if (at + 1 < count && random() < 0.5) values[at + 1] = 18 + random() * 26;
    }
    return values.map(value => Math.round(value * 10) / 10);
}

export type LagChartOptions = {
    width : number;
    height : number;
    /** The space at the left for the scale labels. Zero hides the labels. */
    labelWidth : number;
    colors? : OgColors;
};

/**
 * A bar chart of the lag of each window, as an SVG string, as the home page
 * of the site shows it live. A bar of 50 ms or more is red, and a dashed red
 * line marks 50 ms.
 */
export function lagChartSvg(values : readonly number[], options : LagChartOptions) : string {
    const { width, height, labelWidth, colors = OG_COLORS } = options;
    const top = 14;
    const bottom = height - 3;
    const left = labelWidth;
    const step = (width - left) / Math.max(1, values.length);
    const y = (ms : number) : number => bottom - (Math.min(ms, SCALE_MS) / SCALE_MS) * (bottom - top);
    const bars = values.map((value, index) => {
        const long = value >= LONG_MS;
        const barWidth = Math.max(2, step * (long ? 0.56 : 0.38));
        const x = left + step * index + (step - barWidth) / 2;
        const barTop = y(value);
        return `<rect x="${x.toFixed(1)}" y="${barTop.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${(bottom - barTop).toFixed(1)}" rx="${(barWidth / 3).toFixed(1)}" fill="${long ? colors.mark : colors.inkSecondary}"/>`;
    });
    const labels = labelWidth === 0 ? "" : [0, LONG_MS, 100].map((ms) => {
        const color = ms === LONG_MS ? colors.mark : colors.inkMuted;
        return `<text x="${left - 12}" y="${(y(ms) + 5).toFixed(1)}" text-anchor="end" class="scale" fill="${color}">${ms === 0 ? "0" : `${ms} ms`}</text>`;
    }).join("");
    const threshold = y(LONG_MS).toFixed(1);
    return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">
    ${labels}
    <line x1="${left}" x2="${width}" y1="${threshold}" y2="${threshold}" stroke="${colors.mark}" stroke-width="2" stroke-dasharray="7 6"/>
    ${bars.join("\n    ")}
    <line x1="${left}" x2="${width}" y1="${bottom + 1.5}" y2="${bottom + 1.5}" stroke="${colors.chartAxis}" stroke-width="3"/>
  </svg>`;
}

/**
 * The site mark (refer to `src/app/BrandMark.tsx`) at the height `height`: a
 * strip of frames, and the red frame that the main thread was too busy to
 * deliver.
 */
export function brandMarkSvg(height : number, colors : OgColors = OG_COLORS) : string {
    const width = (height * 26) / 22;
    return `<svg width="${width.toFixed(1)}" height="${height}" viewBox="0 0 26 22" aria-hidden="true">
    <path d="M1 20.5h24" stroke="${colors.inkMuted}" stroke-width="1"/>
    <rect x="2" y="12" width="3" height="8" rx="1" fill="${colors.ink}"/>
    <rect x="7" y="12" width="3" height="8" rx="1" fill="${colors.ink}"/>
    <rect x="12" y="3" width="3" height="17" rx="1" fill="${colors.mark}"/>
    <rect x="17" y="12" width="3" height="8" rx="1" fill="${colors.ink}"/>
    <rect x="22" y="12" width="3" height="8" rx="1" fill="${colors.ink}"/>
  </svg>`;
}

/** The site address without the protocol and without the slash at the end: "owner.github.io/lag". */
export function siteAddress(siteUrl : string) : string {
    const url = new URL(siteUrl);
    return `${url.host}${url.pathname}`.replace(/\/$/, "");
}

/** The text of the image of a route. The home page gets the language and the license of the library. */
export function ogCard(route : StaticRoute, site : SiteFacts, fallbackDescription : string) : OgCard {
    return {
        eyebrow : route.kind === "home" ? `TypeScript library, ${LICENSE} license` : route.section,
        title : route.heading,
        description : route.description ?? fallbackDescription,
        siteName : site.name,
        address : siteAddress(site.url),
        seed : route.path,
    };
}

/**
 * The HTML of a text. A word with a hyphen, for example a run ID or
 * "Page-view", stays on one line. The script of the image makes the title
 * smaller if the word is too wide.
 */
export function unbrokenHtml(text : string) : string {
    return text.split(/(\s+)/).map(part => (part.includes("-") ? `<span class="nowrap">${escapeHtml(part)}</span>` : escapeHtml(part))).join("");
}

/** The `@font-face` rules of the image fonts. The site uses the same fonts. */
export function fontFaces(fonts : OgFonts) : string {
    const faces = (family : string, sources : readonly string[]) : string[] => sources.map(source =>
        `@font-face{font-family:"${family}";src:${source};font-weight:200 800;font-style:normal;font-display:block}`);
    return [...faces("Atkinson Hyperlegible Next", fonts.sans), ...faces("Atkinson Hyperlegible Mono", fonts.mono)].join("\n");
}

/**
 * The script of an image page: it makes the title smaller until the title
 * fits in `lines` lines. A title of one line gives the description one more
 * line. Then the script sets `data-ready` on the body. The build waits for
 * `data-ready` before the screenshot.
 */
export function fitTitleScript(size : number, minimum : number, lines : number, lineHeight : number) : string {
    return `<script>
    document.fonts.ready.then(function () {
      var title = document.querySelector(".title");
      var description = document.querySelector(".description");
      var size = ${size};
      while (size > ${minimum} && (title.getBoundingClientRect().height > size * ${lineHeight} * ${lines} + 2 || title.scrollWidth > title.clientWidth)) {
        size -= 2;
        title.style.fontSize = size + "px";
      }
      if (description && title.getBoundingClientRect().height < size * ${lineHeight} * 1.5) description.style.webkitLineClamp = "4";
      document.body.setAttribute("data-ready", "true");
    });
  </script>`;
}

/** The background of the site: graph paper, with lines of the grid color. */
function graphPaper(color : string, background : string, size : number) : string {
    return `background-color: ${background};
  background-image: linear-gradient(${color} 1.5px, transparent 1.5px), linear-gradient(90deg, ${color} 1.5px, transparent 1.5px);
  background-size: ${size}px ${size}px;
  background-position: -1px -1px;`;
}

/**
 * The HTML page that the build renders to a PNG file of 1200 × 630 pixels.
 * It uses the colors and the fonts of the site: ink on graph paper, and red
 * for the time that the main thread loses.
 */
export function ogImageHtml(card : OgCard, fonts : OgFonts) : string {
    const c = OG_COLORS;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>
${fontFaces(fonts)}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${OG_IMAGE_WIDTH}px; height: ${OG_IMAGE_HEIGHT}px; overflow: hidden; }
body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 452px;
  gap: 52px;
  padding: 56px 60px 52px 72px;
  ${graphPaper(c.grid, c.page, 32)}
  color: ${c.ink};
  font-family: "Atkinson Hyperlegible Next", sans-serif;
  -webkit-font-smoothing: antialiased;
}
.text { display: grid; grid-template-rows: auto 1fr auto; min-width: 0; }
.brand { display: flex; align-items: center; gap: 14px; font-size: 40px; font-weight: 800; letter-spacing: -0.02em; line-height: 1; }
.main { align-self: center; min-width: 0; }
.eyebrow { display: flex; align-items: center; gap: 14px; margin-bottom: 20px; color: ${c.accent}; font-size: 24px; font-weight: 700; }
.eyebrow::before { content: ""; width: 7px; height: 26px; border-radius: 2px; background: ${c.mark}; }
.title { font-size: 68px; font-weight: 800; line-height: 1.05; letter-spacing: -0.03em; text-wrap: balance; }
.nowrap { white-space: nowrap; }
.description { display: -webkit-box; margin-top: 22px; overflow: hidden; color: ${c.inkSecondary}; font-size: 25px; line-height: 1.42; text-wrap: pretty; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
.address { padding-top: 16px; border-top: 2px solid ${c.ink}; color: ${c.inkMuted}; font-family: "Atkinson Hyperlegible Mono", monospace; font-size: 18px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.panel { display: flex; flex-direction: column; gap: 18px; padding: 26px 26px 22px; border: 2px solid ${c.ruleStrong}; border-radius: 10px; background: ${c.surface}; }
.panel-head { display: flex; align-items: baseline; justify-content: space-between; }
.panel-title { font-size: 22px; font-weight: 800; letter-spacing: -0.01em; }
.panel-unit { color: ${c.inkMuted}; font-family: "Atkinson Hyperlegible Mono", monospace; font-size: 15px; }
.chart { flex: 1; display: flex; align-items: flex-end; padding: 8px 0 0; ${graphPaper(c.grid, c.surface, 16)} }
.scale { font-family: "Atkinson Hyperlegible Mono", monospace; font-size: 14px; font-weight: 700; paint-order: stroke; stroke: ${c.surface}; stroke-width: 6px; stroke-linejoin: round; }
.caption { color: ${c.inkSecondary}; font-size: 16px; line-height: 1.4; }
.caption b { color: ${c.mark}; }
</style>
</head>
<body>
  <div class="text">
    <div class="brand">${brandMarkSvg(44)}<span>${escapeHtml(card.siteName)}</span></div>
    <div class="main">
      <p class="eyebrow">${escapeHtml(card.eyebrow)}</p>
      <h1 class="title">${unbrokenHtml(card.title)}</h1>
      <p class="description">${unbrokenHtml(card.description)}</p>
    </div>
    <div class="address">${escapeHtml(card.address)}</div>
  </div>
  <div class="panel">
    <div class="panel-head"><span class="panel-title">Main-thread lag</span><span class="panel-unit">100 ms windows</span></div>
    <div class="chart">${lagChartSvg(lagSeries(card.seed, 26), { width : 396, height : 330, labelWidth : 66 })}</div>
    <p class="caption">One bar for each window. <b>Red</b>: the window ended ${LONG_MS}&nbsp;ms or more late.</p>
  </div>
  ${fitTitleScript(68, 40, 3, 1.05)}
</body>
</html>
`;
}
