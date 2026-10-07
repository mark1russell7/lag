/**
 * Feature detection for the cross-browser tests. A test that needs an API
 * that only some engines have skips itself with one of the reasons here, so
 * the report says why it did not run.
 */

const entryTypes : readonly string[] = typeof PerformanceObserver === "function"
    ? PerformanceObserver.supportedEntryTypes ?? []
    : [];

export type Feature = {
    /** True if this browser has the API. */
    readonly supported : boolean;
    /** The skip reason when the API is missing. */
    readonly reason : string;
};

export type FeatureName =
    | "loaf" | "layoutShift" | "visibilityState" | "eventTiming" | "lcp" | "paint"
    | "computePressure" | "performanceMemory" | "measureUserAgentSpecificMemory"
    | "freezeEvent" | "requestIdleCallback" | "reportingObserver" | "interactionCount";

function feature(supported : boolean, reason : string) : Feature {
    return { supported, reason };
}

const performanceWithMemory = performance as Performance & {
    memory? : unknown;
    measureUserAgentSpecificMemory? : unknown;
    interactionCount? : unknown;
};

export const features : Readonly<Record<FeatureName, Feature>> = {
    loaf : feature(entryTypes.includes("long-animation-frame"),
        "Long Animation Frames (the long-animation-frame entry type) are Chromium-only."),
    layoutShift : feature(entryTypes.includes("layout-shift"),
        "Layout Instability (the layout-shift entry type, CLS) is Chromium-only."),
    visibilityState : feature(entryTypes.includes("visibility-state"),
        "The visibility-state entry type is Chromium-only."),
    eventTiming : feature(entryTypes.includes("event")
        && typeof globalThis.PerformanceEventTiming === "function"
        && "interactionId" in PerformanceEventTiming.prototype,
    "This browser has no Event Timing with interactionId."),
    lcp : feature(entryTypes.includes("largest-contentful-paint"),
        "This browser has no largest-contentful-paint entries."),
    paint : feature(entryTypes.includes("paint"),
        "This browser has no paint entries."),
    computePressure : feature(typeof (globalThis as { PressureObserver? : unknown }).PressureObserver === "function",
        "The Compute Pressure API (PressureObserver) is Chromium-only."),
    performanceMemory : feature(typeof performanceWithMemory.memory === "object" && performanceWithMemory.memory !== null,
        "performance.memory is Chromium-only."),
    measureUserAgentSpecificMemory : feature(typeof performanceWithMemory.measureUserAgentSpecificMemory === "function",
        "performance.measureUserAgentSpecificMemory() needs Chromium in the new headless mode and cross-origin isolation."),
    freezeEvent : feature("onfreeze" in document,
        "The Page Lifecycle freeze and resume events are Chromium-only."),
    requestIdleCallback : feature(typeof globalThis.requestIdleCallback === "function",
        "requestIdleCallback is not in WebKit."),
    reportingObserver : feature(typeof (globalThis as { ReportingObserver? : unknown }).ReportingObserver === "function",
        "This browser has no ReportingObserver (Firefox has it from version 149)."),
    interactionCount : feature(typeof performanceWithMemory.interactionCount === "number",
        "This browser has no performance.interactionCount."),
};
