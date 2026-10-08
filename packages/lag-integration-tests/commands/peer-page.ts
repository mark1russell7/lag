/**
 * This module has Vitest browser commands for a second top-level page of the
 * Vitest server: a peer page. Experiment E7 (`peer-tab.test.ts`) uses it to
 * find out what another page of the origin can see of a hang. The commands
 * operate in Node. They use Playwright, or WebdriverIO for Safari.
 */
import type { BrowserCommand, BrowserCommandContext } from "vitest/node";

type PeerPage = {
    evaluate(expression : string) : Promise<unknown>;
    close() : Promise<void>;
};

/** The open peer pages, by ID. */
const peers = new Map<string, PeerPage>();
let lastId = 0;

const READY = "window.peerReady === true";

async function openWithPlaywright(ctx : BrowserCommandContext, url : string) : Promise<PeerPage> {
    const page = await ctx.context.newPage();
    const errors : string[] = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.goto(url);
    await page.waitForFunction(READY, undefined, { timeout : 10_000 }).catch((error : unknown) => {
        throw new Error(`The page ${url} did not start: ${errors.join("; ") || String(error)}`);
    });
    return {
        evaluate : (expression) => page.evaluate(expression),
        // Without beforeunload, so that the close does not wait for the main thread of the page
        close : () => page.close({ runBeforeUnload : false }),
    };
}

/**
 * Safari through safaridriver: the peer page is a new window. WebDriver
 * operates one window at a time. Thus each operation changes to the window
 * of the peer page, and then back to the window and the frame of the tests.
 */
async function openWithWebdriverio(ctx : BrowserCommandContext, url : string) : Promise<PeerPage> {
    const browser = ctx.browser;
    const provider = ctx.provider as unknown as { isIframeSwitched() : boolean; switchToTestFrame() : Promise<void> };
    const own = await browser.getWindowHandle();
    const inFrame = provider.isIframeSwitched();
    const back = async () : Promise<void> => {
        await browser.switchToWindow(own);
        if (inFrame) await provider.switchToTestFrame();
    };
    const { handle } = await browser.createWindow("window");
    try {
        await browser.switchToWindow(handle);
        await browser.url(url);
        await browser.waitUntil(async () => (await browser.execute(`return ${READY};`) as unknown) === true, { timeout : 10_000 });
    } finally {
        await back();
    }
    const inPeer = async <T>(operation : () => Promise<T>) : Promise<T> => {
        await browser.switchToWindow(handle);
        try {
            return await operation();
        } finally {
            await back();
        }
    };
    return {
        evaluate : (expression) => inPeer(() => browser.execute(`return (${expression});`)),
        close : () => inPeer(() => browser.closeWindow().then(() => undefined)),
    };
}

async function originOf(ctx : BrowserCommandContext) : Promise<string> {
    return new URL(ctx.provider.name === "playwright" ? ctx.page.url() : await ctx.browser.getUrl()).origin;
}

/** This command opens `path` of the Vitest server in a new top-level page, and gives the ID of the page. The page sets `window.peerReady`. */
const openPeerPage : BrowserCommand<[path : string]> = async (ctx, path) => {
    const url = `${await originOf(ctx)}/${path}`;
    const peer = ctx.provider.name === "playwright" ? await openWithPlaywright(ctx, url) : await openWithWebdriverio(ctx, url);
    const id = String(++lastId);
    peers.set(id, peer);
    return id;
};

/** This command gives the value of `expression` in the peer page. */
const evaluateInPeerPage : BrowserCommand<[id : string, expression : string]> = (_ctx, id, expression) => {
    const peer = peers.get(id);
    if (!peer) throw new Error(`No peer page has the ID ${id}.`);
    return peer.evaluate(expression);
};

/**
 * This command closes the peer page. It gives the time of Node
 * (`Date.now()`) at the start and at the end of the close. A second close of
 * the same page does nothing.
 */
const closePeerPage : BrowserCommand<[id : string]> = async (_ctx, id) => {
    const peer = peers.get(id);
    if (!peer) return undefined;
    peers.delete(id);
    const startedAt = Date.now();
    await peer.close();
    return { startedAt, endedAt : Date.now() };
};

export const peerPageCommands = { openPeerPage, evaluateInPeerPage, closePeerPage };
