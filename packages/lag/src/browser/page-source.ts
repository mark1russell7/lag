import type { PerformanceEntryLike } from "../perf-types.js";
import type { LifecycleListener, LifecycleListenerOptions } from "../LifecycleStateMachine.js";
import type { NavigationInfo, PageSource } from "../vitals/types.js";

/** The `document` fields that the page source reads. */
export type PageDocument = {
    /** Chromium only. */
    readonly prerendering? : boolean;
    /** Chromium only. */
    readonly wasDiscarded? : boolean;
    /** The URL of the document. It is null for a document without a browsing context. */
    readonly location? : { readonly href : string } | null;
    addEventListener(type : string, listener : LifecycleListener, options? : LifecycleListenerOptions) : void;
    removeEventListener(type : string, listener : LifecycleListener, options? : LifecycleListenerOptions) : void;
};

/** The `performance` fields that the page source reads. */
export type PagePerformance = {
    now() : number;
    getEntriesByType?(type : string) : readonly PerformanceEntryLike[];
};

/** The Navigation Timing fields that the page source reads. */
type NavigationEntryLike = PerformanceEntryLike & {
    type? : string;
    responseStart? : number;
    activationStart? : number;
};

function navigationType(type : string | undefined) : NavigationInfo["type"] {
    switch (type) {
        case "reload": return "reload";
        case "back_forward": return "back-forward";
        case "prerender": return "prerender";
        default: return "navigate";
    }
}

/**
 * The page source of a browser document. It reads the Navigation Timing
 * entry, the `visibility-state` entries, the prerender state and the URL of
 * the document.
 *
 * As web-vitals does, the source ignores a navigation entry with a
 * `responseStart` that is 0 or that is not before `performance.now()`. Some
 * browsers give such values for privacy or because of errors.
 */
export function createPageSource(document : PageDocument, performance : PagePerformance) : PageSource {
    const entries = (type : string) : readonly PerformanceEntryLike[] => {
        try {
            return performance.getEntriesByType?.(type) ?? [];
        } catch {
            return [];
        }
    };
    return {
        navigation() {
            const entry = entries("navigation")[0] as NavigationEntryLike | undefined;
            const responseStart = entry?.responseStart;
            if (!entry || responseStart === undefined || !(responseStart > 0) || responseStart >= performance.now()) {
                return undefined;
            }
            return {
                type : navigationType(entry.type),
                activationStart : entry.activationStart ?? 0,
                responseStart,
                url : entry.name,
            };
        },
        isPrerendering : () => document.prerendering === true,
        wasDiscarded : () => document.wasDiscarded === true,
        hiddenTimes : () => entries("visibility-state").filter(e => e.name === "hidden").map(e => e.startTime),
        url : () => document.location?.href,
        onActivation(listener) {
            const handler = () => listener();
            const options = { capture : true };
            document.addEventListener("prerenderingchange", handler, options);
            return () => document.removeEventListener("prerenderingchange", handler, options);
        },
    };
}
