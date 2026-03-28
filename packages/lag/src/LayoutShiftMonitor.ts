import { ObserverMonitor } from "./ObserverMonitor.js";
import type { PerformanceEntryLike, PerformanceObserverInit, LayoutShiftEntry } from "./perf-types.js";
import type { Logger } from "./types.js";

export type LayoutShiftReport = {
    value : number;
    sessionValue : number;
    worstSessionValue : number;
};

const SESSION_GAP_MS = 1000;
const SESSION_MAX_MS = 5000;

export class LayoutShiftMonitor extends ObserverMonitor {
    private sessionValue = 0;
    private sessionStart = -1;
    private lastShiftTime = -1;
    private worstSessionValue = 0;

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

        const shiftTime = shift.startTime;

        // Start new session if gap > 1s or session > 5s
        if (
            this.sessionStart === -1 ||
            shiftTime - this.lastShiftTime > SESSION_GAP_MS ||
            shiftTime - this.sessionStart > SESSION_MAX_MS
        ) {
            this.sessionValue = 0;
            this.sessionStart = shiftTime;
        }

        this.sessionValue += shift.value;
        this.lastShiftTime = shiftTime;

        if (this.sessionValue > this.worstSessionValue) {
            this.worstSessionValue = this.sessionValue;
        }

        this.report({
            value : shift.value,
            sessionValue : this.sessionValue,
            worstSessionValue : this.worstSessionValue,
        });
    }

    getCLS() : number {
        return this.worstSessionValue;
    }

    override stop() : void {
        super.stop();
        this.sessionValue = 0;
        this.sessionStart = -1;
        this.lastShiftTime = -1;
        this.worstSessionValue = 0;
    }
}
