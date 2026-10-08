/**
 * This module is the browser side of the custom Vitest commands. The Node
 * side is in `commands/`. Tests import the functions here, not `commands`
 * directly.
 */
import { commands, server } from "vitest/browser";
import { inject } from "vitest";
import type { BudgetPayload, FreezeResult, HeapUsage, MeasurementPayload } from "./command-types.js";

declare module "vitest/browser" {
    interface BrowserCommands {
        freezePage : (ms : number) => Promise<FreezeResult>;
        hidePage : () => Promise<void>;
        showPage : () => Promise<void>;
        setCpuThrottling : (rate : number) => Promise<void>;
        getPerformanceMetrics : () => Promise<Record<string, number>>;
        collectGarbage : () => Promise<void>;
        getHeapUsage : () => Promise<HeapUsage>;
        setPressureState : (state : "nominal" | "fair" | "serious" | "critical" | null) => Promise<void>;
        resetPage : () => Promise<void>;
        recordMeasurement : (measurement : MeasurementPayload) => Promise<void>;
        recordBudget : (budget : BudgetPayload) => Promise<void>;
        queryMimirValue : (query : string) => Promise<number>;
        clickInTopLevelPage : (path : string, selector : string, waitMs : number, resultExpression : string) => Promise<unknown>;
        startProbeSocketServer : () => Promise<number>;
        stopProbeSocketServer : () => Promise<number[]>;
        openPeerPage : (path : string) => Promise<string>;
        evaluateInPeerPage : (id : string, expression : string) => Promise<unknown>;
        closePeerPage : (id : string) => Promise<{ startedAt : number; endedAt : number } | undefined>;
    }
}

/** The environment of this test run: "chromium", "firefox", "webkit" or "chrome". */
export function environment() : string {
    return inject("environment") ?? server.browser;
}

/** The CDP commands. Only the Chromium projects (cdp, overhead, soak) can use them. */
export const cdp = {
    freezePage : (ms : number) : Promise<FreezeResult> => commands.freezePage(ms),
    hidePage : () : Promise<void> => commands.hidePage(),
    showPage : () : Promise<void> => commands.showPage(),
    setCpuThrottling : (rate : number) : Promise<void> => commands.setCpuThrottling(rate),
    getPerformanceMetrics : () : Promise<Record<string, number>> => commands.getPerformanceMetrics(),
    collectGarbage : () : Promise<void> => commands.collectGarbage(),
    getHeapUsage : () : Promise<HeapUsage> => commands.getHeapUsage(),
    /** This function replaces the CPU pressure source with a virtual source in this state. The value `null` restores the real source. */
    setPressureState : (state : "nominal" | "fair" | "serious" | "critical" | null) : Promise<void> => commands.setPressureState(state),
    resetPage : () : Promise<void> => commands.resetPage(),
};

/**
 * This function saves a set of values for the results collector. The site
 * groups the measurements of a run by the last segment of `name` and the
 * unit. For example, "stress/heavy/lag_drift_histogram" is in the family
 * "lag_drift_histogram (ms)".
 */
export function recordMeasurement(name : string, unit : string, values : readonly number[], labels : Record<string, string> = {}) : Promise<void> {
    return commands.recordMeasurement({ name, unit, values : [...values], labels });
}

/**
 * This function opens `path` of the Vitest server in a new top-level page
 * (Playwright only). It clicks `selector`, waits `waitMs`, and gives the value
 * of `resultExpression` in that page. A test in the frame of Vitest uses it
 * for the behavior of a top-level page, for example a soft navigation.
 */
export function clickInTopLevelPage<T>(path : string, selector : string, waitMs : number, resultExpression : string) : Promise<T> {
    return commands.clickInTopLevelPage(path, selector, waitMs, resultExpression) as Promise<T>;
}

/**
 * This function starts a WebSocket server in Node, on a free port of
 * 127.0.0.1, and gives the port. The server records when each message
 * arrives, with `Date.now()` of Node.
 */
export function startProbeSocketServer() : Promise<number> {
    return commands.startProbeSocketServer();
}

/** This function stops the WebSocket server and gives the arrival times of the messages (`Date.now()` of Node). */
export function stopProbeSocketServer() : Promise<number[]> {
    return commands.stopProbeSocketServer();
}

/**
 * This function opens `path` of the Vitest server in a second top-level page
 * (a peer page), and gives its ID. It waits until the page sets
 * `window.peerReady`. In Safari, the peer page is a new window.
 */
export function openPeerPage(path : string) : Promise<string> {
    return commands.openPeerPage(path);
}

/** This function gives the value of `expression` in the peer page `id`. */
export function evaluateInPeerPage<T>(id : string, expression : string) : Promise<T> {
    return commands.evaluateInPeerPage(id, expression) as Promise<T>;
}

/** This function closes the peer page `id`, and gives the time of Node (`Date.now()`) at the start and at the end of the close. */
export function closePeerPage(id : string) : Promise<{ startedAt : number; endedAt : number } | undefined> {
    return commands.closePeerPage(id);
}

/** This function sends a PromQL query to Mimir from Node, because Mimir sends no CORS headers. It gives the first value, or 0. */
export function queryMimirValue(query : string) : Promise<number> {
    return commands.queryMimirValue(query);
}

/** This function saves a budget check for the results collector. The budget passes when `value <= limit`. */
export function recordBudget(budget : BudgetPayload) : Promise<void> {
    return commands.recordBudget(budget);
}
