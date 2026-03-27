import { ObserverMonitor } from "./ObserverMonitor.js";
import type { PerformanceEntryLike, PerformanceObserverInit, LoafEntry } from "./perf-types.js";
import type { Logger } from "./types.js";

export type LoafReport = {
    blockingDuration : number;
    duration : number;
    renderDuration : number;
    scriptCount : number;
    hasForceLayout : boolean;
};

export class LongAnimationFrameMonitor extends ObserverMonitor {
    constructor(
        private readonly report : (entry : LoafReport) => void,
        logger : Logger,
        PerformanceObserverCtor : PerformanceObserverInit,
    ) {
        super("long-animation-frame", logger, PerformanceObserverCtor);
    }

    protected processEntry(entry : PerformanceEntryLike) : void {
        const loaf = entry as LoafEntry;
        const renderDuration = loaf.duration - (loaf.styleAndLayoutStart - loaf.startTime);
        const hasForceLayout = loaf.scripts?.some(
            s => s.forcedStyleAndLayoutDuration > 0,
        ) ?? false;

        this.report({
            blockingDuration : loaf.blockingDuration,
            duration : loaf.duration,
            renderDuration,
            scriptCount : loaf.scripts?.length ?? 0,
            hasForceLayout,
        });
    }
}
