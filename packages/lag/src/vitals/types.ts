/** The Core Web Vitals and the other page-view metrics. */
export type VitalName = "INP" | "CLS" | "LCP" | "FCP" | "TTFB";

/**
 * How the page view started. The values are the values of web-vitals and of
 * the OpenTelemetry attribute `browser.web_vital.navigation_type`:
 * - `navigate`, `reload`, `back-forward`: a load (Navigation Timing).
 * - `prerender`: a load that the browser prerendered before the activation.
 * - `restore`: a load after the browser discarded the page.
 * - `back-forward-cache`: a restore from the back/forward cache.
 * - `soft-navigation`: a same-document navigation (Chromium 151 and later).
 */
export type NavigationType =
    | "navigate"
    | "reload"
    | "back-forward"
    | "back-forward-cache"
    | "prerender"
    | "restore"
    | "soft-navigation";

export const NAVIGATION_TYPES : readonly NavigationType[] = [
    "navigate",
    "reload",
    "back-forward",
    "back-forward-cache",
    "prerender",
    "restore",
    "soft-navigation",
];

export type Rating = "good" | "needs-improvement" | "poor";

/** The thresholds of each vital. A value at or below `good` is good. A value above `poor` is poor. */
export const VITAL_THRESHOLDS : Readonly<Record<VitalName, { good : number; poor : number }>> = {
    INP : { good : 200, poor : 500 },
    CLS : { good : 0.1, poor : 0.25 },
    LCP : { good : 2_500, poor : 4_000 },
    FCP : { good : 1_800, poor : 3_000 },
    TTFB : { good : 800, poor : 1_800 },
};

/** The rating of a value, with the thresholds of web-vitals. */
export function rateVital(name : VitalName, value : number) : Rating {
    const { good, poor } = VITAL_THRESHOLDS[name];
    if (value <= good) return "good";
    if (value <= poor) return "needs-improvement";
    return "poor";
}

/** The value of one vital for one page view. */
export type VitalValue = {
    name : VitalName;
    value : number;
    /**
     * The details that identify the cause, for example CSS selectors and URLs.
     * They have many different values, thus only events can contain them.
     * Metric attributes must not contain them.
     */
    attribution : Readonly<Record<string, string | number>>;
};

/** The data of the Navigation Timing entry that the vitals use. */
export type NavigationInfo = {
    type : "navigate" | "reload" | "back-forward" | "prerender";
    /** The time of the activation of a prerendered page. It is 0 for a page that the browser did not prerender. */
    activationStart : number;
    responseStart : number;
    /** The URL of the document. */
    url : string;
};

/**
 * The document and navigation state that the page-view vitals read. The
 * browser adapter (`createPageSource`) gets this state from `document` and
 * `performance`.
 */
export type PageSource = {
    /**
     * The navigation entry of the document. The value is undefined when the
     * browser gives no entry or an entry with an incorrect `responseStart`.
     */
    navigation() : NavigationInfo | undefined;
    /** True while the browser prerenders the document (`document.prerendering`). */
    isPrerendering() : boolean;
    /** True when the browser discarded the page before this load (`document.wasDiscarded`). */
    wasDiscarded() : boolean;
    /** The start times of the `visibility-state` entries with the name `hidden` (Chromium only). */
    hiddenTimes() : readonly number[];
    /** Adds a listener for the activation of a prerendered page. The return value removes the listener. */
    onActivation(listener : () => void) : () => void;
};
