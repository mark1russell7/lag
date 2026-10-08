/**
 * This module has a Vitest browser command for a top-level page. The tests of
 * Vitest operate in a frame, but some behavior occurs only in a top-level
 * page. For example, Chrome detects soft navigations only in the top-level
 * frame. The command operates in Node and uses Playwright.
 */
import type { BrowserCommand, BrowserCommandContext } from "vitest/node";

const sleep = (ms : number) : Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/**
 * This command opens `path` of the Vitest server in a new top-level page. It
 * clicks `selector` with Playwright and waits `waitMs`. Then it gives the
 * value of `resultExpression` in the page, and closes the page. The page
 * sets `window.probeReady` when it can get the click.
 */
const clickInTopLevelPage : BrowserCommand<[path : string, selector : string, waitMs : number, resultExpression : string]> = async (ctx : BrowserCommandContext, path, selector, waitMs, resultExpression) => {
    if (ctx.provider.name !== "playwright") throw new Error("clickInTopLevelPage needs the Playwright provider.");
    const origin = new URL(ctx.page.url()).origin;
    const page = await ctx.context.newPage();
    const errors : string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    try {
        await page.goto(`${origin}/${path}`);
        await page.waitForFunction("window.probeReady === true", undefined, { timeout : 10_000 }).catch((error : unknown) => {
            throw new Error(`The page ${path} did not start: ${errors.join("; ") || String(error)}`);
        });
        // A short wait, so that the first paints of the page come before the click
        await sleep(500);
        await page.click(selector);
        await sleep(waitMs);
        return await page.evaluate(resultExpression);
    } finally {
        await page.close();
    }
};

export const topLevelPageCommands = { clickInTopLevelPage };
