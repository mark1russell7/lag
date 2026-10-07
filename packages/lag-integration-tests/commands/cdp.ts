/**
 * Vitest browser commands that use the Chrome DevTools Protocol. They run in
 * Node, in the Vitest process, and control the page that runs the test file.
 * They work only with the Playwright provider and Chromium.
 *
 * Playwright emulates focus on every page (`Emulation.setFocusEmulationEnabled`).
 * Chromium implements focus emulation as a page capture, and a captured page
 * stays visible: `Page.setWebLifecycleState` then has no effect, and a page
 * that is behind another page stays visible. The commands that change the
 * visibility turn off focus emulation on Playwright's own CDP session first,
 * and turn it on again when they finish. Playwright does not make that
 * session public, so `playwrightSession` reads it from Playwright internals
 * (tested with Playwright 1.58).
 */
import type { BrowserCommand, BrowserCommandContext } from "vitest/node";
import type { CDPSession, Page } from "playwright";
import type { FreezeResult, HeapUsage } from "../src/command-types.js";

type RawSession = { send(method : string, params? : object) : Promise<unknown> };

const sessions = new Map<string, Promise<CDPSession>>();
/** The second page of each session while the test page is hidden. */
const coverPages = new Map<string, Page>();
const performanceEnabled = new Set<string>();
/** The sessions with a virtual CPU pressure source. */
const pressureOverridden = new Set<string>();

const sleep = (ms : number) : Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function assertChromium(ctx : BrowserCommandContext, command : string) : void {
    if (ctx.provider.name !== "playwright" || ctx.project.config.browser.name !== "chromium") {
        throw new Error(`${command} needs Chromium with the Playwright provider, not ${ctx.project.config.browser.name}.`);
    }
}

/** A CDP session of the test page. The session stays open, so that emulation (CPU throttling) stays on. */
function cdp(ctx : BrowserCommandContext, command : string) : Promise<CDPSession> {
    assertChromium(ctx, command);
    let session = sessions.get(ctx.sessionId);
    if (!session) {
        session = ctx.page.context().newCDPSession(ctx.page);
        sessions.set(ctx.sessionId, session);
    }
    return session;
}

/** Playwright's own CDP session of the main frame. Only that session can turn off its focus emulation. */
function playwrightSession(page : Page) : RawSession {
    const connection = (page as unknown as { _connection? : { toImpl? : (object : unknown) => unknown } })._connection;
    const impl = connection?.toImpl?.(page) as { delegate? : { _mainFrameSession? : { _client? : RawSession } } } | undefined;
    const client = impl?.delegate?._mainFrameSession?._client;
    if (!client) {
        throw new Error("Cannot find the CDP session of Playwright. The Playwright internals changed: update commands/cdp.ts.");
    }
    return client;
}

async function setFocusEmulation(ctx : BrowserCommandContext, enabled : boolean) : Promise<void> {
    await playwrightSession(ctx.page).send("Emulation.setFocusEmulationEnabled", { enabled });
}

/**
 * Freezes the page for `ms` milliseconds and makes it active and visible
 * again. The page cannot run while it is frozen, thus this command does the
 * whole sequence. The page sees: `visibilitychange` (hidden), `freeze`,
 * `resume`, `visibilitychange` (visible).
 */
export const freezePage : BrowserCommand<[ms : number], FreezeResult> = async (ctx, ms) => {
    const session = await cdp(ctx, "freezePage");
    await setFocusEmulation(ctx, false);
    const start = Date.now();
    try {
        await session.send("Page.setWebLifecycleState", { state : "frozen" });
        await sleep(ms);
        await session.send("Page.setWebLifecycleState", { state : "active" });
    } finally {
        await setFocusEmulation(ctx, true);
    }
    return { frozenMs : Date.now() - start };
};

/** Hides the test page: another page of the same browser context comes to the front. Needs the new headless mode. */
export const hidePage : BrowserCommand<[], void> = async (ctx) => {
    assertChromium(ctx, "hidePage");
    await setFocusEmulation(ctx, false);
    const cover = await ctx.context.newPage();
    coverPages.set(ctx.sessionId, cover);
    await cover.bringToFront();
};

/** Shows the test page again after `hidePage`. */
export const showPage : BrowserCommand<[], void> = async (ctx) => {
    assertChromium(ctx, "showPage");
    await ctx.page.bringToFront();
    await coverPages.get(ctx.sessionId)?.close();
    coverPages.delete(ctx.sessionId);
    await setFocusEmulation(ctx, true);
};

/** `Emulation.setCPUThrottlingRate`: 1 is no throttling, 4 is four times slower. */
export const setCpuThrottling : BrowserCommand<[rate : number], void> = async (ctx, rate) => {
    const session = await cdp(ctx, "setCpuThrottling");
    await session.send("Emulation.setCPUThrottlingRate", { rate });
};

/** `Performance.getMetrics` of the page's renderer, by name. Durations are in seconds. */
export const getPerformanceMetrics : BrowserCommand<[], Record<string, number>> = async (ctx) => {
    const session = await cdp(ctx, "getPerformanceMetrics");
    if (!performanceEnabled.has(ctx.sessionId)) {
        await session.send("Performance.enable", { timeDomain : "timeTicks" });
        performanceEnabled.add(ctx.sessionId);
    }
    const { metrics } = await session.send("Performance.getMetrics");
    return Object.fromEntries(metrics.map(metric => [metric.name, metric.value]));
};

/** Runs a full garbage collection in the page's isolate. */
export const collectGarbage : BrowserCommand<[], void> = async (ctx) => {
    const session = await cdp(ctx, "collectGarbage");
    await session.send("HeapProfiler.collectGarbage");
};

export const getHeapUsage : BrowserCommand<[], HeapUsage> = async (ctx) => {
    const session = await cdp(ctx, "getHeapUsage");
    const { usedSize, totalSize } = await session.send("Runtime.getHeapUsage");
    return { usedSize, totalSize };
};

export type PressureState = "nominal" | "fair" | "serious" | "critical";

/**
 * Replaces the CPU pressure source of the Compute Pressure API with a
 * virtual source in the given state. `null` gives the real source back.
 */
export const setPressureState : BrowserCommand<[state : PressureState | null], void> = async (ctx, state) => {
    // The Emulation pressure commands are experimental: Playwright's protocol types do not have them
    const session = await cdp(ctx, "setPressureState") as unknown as RawSession;
    if (state === null) {
        await disablePressureOverride(ctx.sessionId, session);
        return;
    }
    if (!pressureOverridden.has(ctx.sessionId)) {
        await session.send("Emulation.setPressureSourceOverrideEnabled", { enabled : true, source : "cpu" });
        pressureOverridden.add(ctx.sessionId);
    }
    // setPressureDataOverride replaced setPressureStateOverride (which gives "Internal error" in Chromium 145)
    await session.send("Emulation.setPressureDataOverride", { source : "cpu", state });
};

async function disablePressureOverride(sessionId : string, session : RawSession) : Promise<void> {
    if (!pressureOverridden.delete(sessionId)) return;
    await session.send("Emulation.setPressureSourceOverrideEnabled", { enabled : false, source : "cpu" });
}

/** Undoes every change of the commands above: no throttling, the test page in front, focus emulation on. */
export const resetPage : BrowserCommand<[], void> = async (ctx) => {
    if (ctx.provider.name !== "playwright" || ctx.project.config.browser.name !== "chromium") return;
    const session = await cdp(ctx, "resetPage");
    await session.send("Emulation.setCPUThrottlingRate", { rate : 1 });
    await disablePressureOverride(ctx.sessionId, session as unknown as RawSession);
    if (coverPages.has(ctx.sessionId)) {
        await ctx.page.bringToFront();
        await coverPages.get(ctx.sessionId)?.close();
        coverPages.delete(ctx.sessionId);
    }
    await setFocusEmulation(ctx, true);
};

export const cdpCommands = {
    freezePage,
    hidePage,
    showPage,
    setCpuThrottling,
    getPerformanceMetrics,
    collectGarbage,
    getHeapUsage,
    setPressureState,
    resetPage,
};
