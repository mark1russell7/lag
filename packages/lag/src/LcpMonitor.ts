import { ObserverMonitor } from "./ObserverMonitor.js";
import type { PerformanceEntryLike, PerformanceObserverInit, LcpEntry } from "./perf-types.js";
import type { Logger } from "./types.js";

export type LcpReport = {
    renderTime : number;
    loadTime : number;
    size : number;
    url : string;
    elementId : string;
};

/**
 * Observes the "largest-contentful-paint" entry type — a key web vital.
 *
 * The LCP fires multiple times during page load as larger candidates appear.
 * The "true" LCP is the *last* entry observed before the user interacts or
 * scrolls. The OTel-exported lcp_gauge tracks the latest value.
 *
 * Per spec, LCP can update via:
 * - First contentful element rendered
 * - A larger element rendered later
 * - User interaction (scroll/keypress) finalizes the value
 */
export class LcpMonitor extends ObserverMonitor {
    private latestLcp = 0;
    private latestEntry : LcpEntry | undefined;

    constructor(
        private readonly report : (entry : LcpReport) => void,
        logger : Logger,
        PerformanceObserverCtor : PerformanceObserverInit,
    ) {
        super("largest-contentful-paint", logger, PerformanceObserverCtor);
    }

    protected processEntry(entry : PerformanceEntryLike) : void {
        const lcp = entry as LcpEntry;
        // renderTime is 0 for cross-origin images without Timing-Allow-Origin;
        // fall back to loadTime in that case
        const time = lcp.renderTime || lcp.loadTime;

        if (time > this.latestLcp) {
            this.latestLcp = time;
            this.latestEntry = lcp;

            this.report({
                renderTime : lcp.renderTime,
                loadTime : lcp.loadTime,
                size : lcp.size,
                url : lcp.url ?? "",
                elementId : lcp.id ?? "",
            });
        }
    }

    getLCP() : number {
        return this.latestLcp;
    }

    getLatestEntry() : LcpEntry | undefined {
        return this.latestEntry;
    }
}
