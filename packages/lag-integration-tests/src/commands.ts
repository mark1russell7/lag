/**
 * The browser side of the custom Vitest commands (see `commands/` for the
 * Node side). Tests import the functions here, not `commands` directly.
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
    /** A virtual CPU pressure source in this state; `null` restores the real source. */
    setPressureState : (state : "nominal" | "fair" | "serious" | "critical" | null) : Promise<void> => commands.setPressureState(state),
    resetPage : () : Promise<void> => commands.resetPage(),
};

/**
 * Saves a set of values for the results collector. The site groups the
 * measurements of a run by the last segment of `name` and the unit, for
 * example "stress/heavy/lag_drift_histogram" is in the family
 * "lag_drift_histogram (ms)".
 */
export function recordMeasurement(name : string, unit : string, values : readonly number[], labels : Record<string, string> = {}) : Promise<void> {
    return commands.recordMeasurement({ name, unit, values : [...values], labels });
}

/** Saves a budget check for the results collector. The budget passes when `value <= limit`. */
export function recordBudget(budget : BudgetPayload) : Promise<void> {
    return commands.recordBudget(budget);
}
