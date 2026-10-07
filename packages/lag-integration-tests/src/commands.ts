/**
 * The browser side of the custom Vitest commands (see `commands/` for the
 * Node side). Tests import the functions here, not `commands` directly.
 */
import { commands, server } from "vitest/browser";
import { inject } from "vitest";
import type { BudgetPayload, MeasurementPayload } from "./command-types.js";

declare module "vitest/browser" {
    interface BrowserCommands {
        recordMeasurement : (measurement : MeasurementPayload) => Promise<void>;
        recordBudget : (budget : BudgetPayload) => Promise<void>;
    }
}

/** The environment of this test run: "chromium", "firefox", "webkit" or "chrome". */
export function environment() : string {
    return inject("environment") ?? server.browser;
}

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
