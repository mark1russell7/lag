import { ObserverMonitor } from "./ObserverMonitor.js";
import type { PerformanceEntryLike, PerformanceObserverInit, LoafEntry } from "./perf-types.js";
import type { Logger } from "./types.js";

export type LoafReport = {
    blockingDuration : number;
    duration : number;
    /**
     * Time from the start of the frame's rendering phase (rAF callbacks,
     * style, layout, paint) to the end of the frame. 0 when the frame did not
     * render — browsers report `renderStart = 0` in that case.
     */
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
        const renderDuration = loaf.renderStart > 0
            ? loaf.startTime + loaf.duration - loaf.renderStart
            : 0;
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
