/**
 * This script makes the social preview of the repository:
 * `.github/social-preview.png`, 1280 × 640 pixels. Use
 * `pnpm --filter @lag/site social-preview`, and then upload the file in the
 * settings of the repository on GitHub (Settings > General > Social preview).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderImages } from "./prerender";
import { LAG_SOCIAL_CARD, SOCIAL_CARD_HEIGHT, SOCIAL_CARD_WIDTH, socialCardHtml } from "./social-card";
import { launchChromium, siteFonts } from "./static-site-plugin";

const siteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(siteDir, "..", "..", ".github");

const browser = await launchChromium();
try {
    const html = socialCardHtml(LAG_SOCIAL_CARD, await siteFonts(siteDir));
    await renderImages(browser, outDir, [{ file : "social-preview.png", html }], SOCIAL_CARD_WIDTH, SOCIAL_CARD_HEIGHT);
    console.log(`Wrote ${path.join(outDir, "social-preview.png")}.`);
} finally {
    await browser.close();
}
