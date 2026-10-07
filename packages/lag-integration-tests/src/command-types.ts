/**
 * The types that the Node side (the Vitest browser commands in `commands/`)
 * and the browser side (the tests) share. Only types: this module runs in
 * neither environment.
 */

/** The result of `freezePage`. The times come from the Node clock. */
export type FreezeResult = {
    /** The time from the "frozen" command to the "active" command, in ms. */
    frozenMs : number;
};

/** `Runtime.getHeapUsage` of the page's main isolate (the test frame shares it). */
export type HeapUsage = {
    usedSize : number;
    totalSize : number;
};

/** One set of values from a test, for the results collector. */
export type MeasurementPayload = {
    /** A unique name in the suite, for example "stress/heavy/lag_drift_histogram". The last segment is the metric. */
    name : string;
    unit : string;
    values : number[];
    /** Low-cardinality labels. The command adds `browser`. */
    labels? : Record<string, string>;
};

/** One budget check from a test, for the results collector. */
export type BudgetPayload = {
    name : string;
    unit : string;
    value : number;
    limit : number;
};

/** One line of the files that the result commands write (JSON Lines). */
export type ResultRecord =
    | { kind : "measurement"; project : string; environment : string; file : string; measurement : Required<MeasurementPayload> }
    | { kind : "budget"; project : string; environment : string; file : string; budget : BudgetPayload & { pass : boolean } };

declare module "vitest" {
    export interface ProvidedContext {
        /** The environment name of the instance: "chromium", "firefox", "webkit" or "chrome". */
        environment : string;
        /** True in the e2e project: the Grafana stack runs, so the Mimir checks are required. */
        e2e : boolean;
        /** The duration of the soak test, in ms. */
        soakMs : number;
    }
}
