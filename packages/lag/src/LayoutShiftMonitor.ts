import { ObserverMonitor } from "./ObserverMonitor.js";
import { ClsCalculator } from "./ClsCalculator.js";
import type { PerformanceEntryLike, PerformanceObserverInit, LayoutShiftEntry } from "./perf-types.js";
import type { Logger } from "./types.js";

export type LayoutShiftReport = {
    value : number;
    startTime : number;
    sessionValue : number;
    worstSessionValue : number;
    sources : LayoutShiftEntry["sources"];
};

/** Observes layout shifts that did not follow user input, and calculates the page-lifetime CLS. */
export class LayoutShiftMonitor extends ObserverMonitor {
    private readonly cls = new ClsCalculator();

    constructor(
        private readonly report : (entry : LayoutShiftReport) => void,
        logger : Logger,
        PerformanceObserverCtor : PerformanceObserverInit,
    ) {
        super("layout-shift", logger, PerformanceObserverCtor);
    }

    protected processEntry(entry : PerformanceEntryLike) : void {
        const shift = entry as LayoutShiftEntry;

        // Exclude shifts caused by user input
        if (shift.hadRecentInput) {
            return;
        }

        const sources = shift.sources ?? [];
        const sessionValue = this.cls.add(shift.startTime, shift.value, sources);
        this.report({
            value : shift.value,
            startTime : shift.startTime,
            sessionValue,
            worstSessionValue : this.cls.getCLS(),
            sources,
        });
    }

    getCLS() : number {
        return this.cls.getCLS();
    }

    override stop() : void {
        super.stop();
        // A restart reads the browser's buffered entries again, so start clean
        this.cls.reset();
    }
}
