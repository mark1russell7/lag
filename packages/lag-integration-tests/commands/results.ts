/**
 * Vitest browser commands that save measurements and budget results for the
 * results collector (`pnpm results`). They append JSON Lines to
 * `$LAG_RESULTS_DIR/results.jsonl`. Without `LAG_RESULTS_DIR`, they do
 * nothing, so a normal test run writes no files.
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { BrowserCommand, BrowserCommandContext } from "vitest/node";
import type { BudgetPayload, MeasurementPayload, ResultRecord } from "../src/command-types.js";

export const RESULTS_DIR_ENV = "LAG_RESULTS_DIR";
export const RESULTS_FILE = "results.jsonl";

/** Appends one line at a time: parallel test files call the commands at the same time. */
let queue : Promise<void> = Promise.resolve();

function environmentOf(ctx : BrowserCommandContext) : string {
    const provided = ctx.project.getProvidedContext() as { environment? : unknown };
    return typeof provided.environment === "string" ? provided.environment : ctx.project.config.browser.name;
}

function testFileOf(ctx : BrowserCommandContext) : string {
    return ctx.testPath ? path.relative(ctx.project.config.root, ctx.testPath).replace(/\\/g, "/") : "";
}

function append(record : ResultRecord) : Promise<void> {
    const dir = process.env[RESULTS_DIR_ENV];
    if (!dir) return Promise.resolve();
    const line = `${JSON.stringify(record)}\n`;
    const next = queue.then(async () => {
        await mkdir(dir, { recursive : true });
        await appendFile(path.join(dir, RESULTS_FILE), line, "utf8");
    });
    queue = next.catch(() => {});
    return next;
}

export const recordMeasurement : BrowserCommand<[measurement : MeasurementPayload], void> = (ctx, measurement) => {
    const environment = environmentOf(ctx);
    return append({
        kind : "measurement",
        project : ctx.project.name,
        environment,
        file : testFileOf(ctx),
        measurement : {
            name : measurement.name,
            unit : measurement.unit,
            // JSON has no NaN or Infinity
            values : measurement.values.filter(value => Number.isFinite(value)),
            labels : { browser : environment, ...measurement.labels },
        },
    });
};

export const recordBudget : BrowserCommand<[budget : BudgetPayload], void> = (ctx, budget) => {
    return append({
        kind : "budget",
        project : ctx.project.name,
        environment : environmentOf(ctx),
        file : testFileOf(ctx),
        budget : { ...budget, pass : budget.value <= budget.limit },
    });
};

export const resultCommands = { recordMeasurement, recordBudget };
