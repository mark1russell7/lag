/**
 * The Node side (the Vitest browser commands in `commands/`) and the browser
 * side (the tests) share the types in this module. The module has only
 * types, so it does not operate in either environment.
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

/** The result of `leaveAndReturnToPeerPage`. */
export type BackForwardResult = {
    /** True if the browser restored the page from the back/forward cache. */
    restored : boolean;
    /** If not, the reasons that Chromium gives to the page (`notRestoredReasons`), for example "broadcastchannel-message". */
    reasons : string[];
    /**
     * If not, the reasons of the Chrome DevTools Protocol (`Page.backForwardCacheNotUsed`), for example
     * "BroadcastChannelOnMessage". They include the reasons that the page gets only as "masked".
     */
    explanations : { type : string; reason : string }[];
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
        /** The environment name of the instance: "chromium", "firefox", "webkit", "chrome", "safari" or "ios". */
        environment : string;
        /** True in the e2e project: the Grafana stack operates, so the Mimir checks are necessary. */
        e2e : boolean;
        /** The duration of the soak test, in ms. */
        soakMs : number;
        /** The block of the page that experiment E7 closes during its block, in ms. */
        e7CloseBlockMs : number;
        /**
         * The platform of the machine of the tests (`process.platform` of Node).
         * The WebKit build of Playwright gives a user agent of macOS on each platform.
         */
        platform : string;
    }
}
