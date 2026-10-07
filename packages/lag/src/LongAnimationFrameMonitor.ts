import { ObserverMonitor } from "./ObserverMonitor.js";
import type { PerformanceEntryLike, PerformanceObserverInit, LoafEntry } from "./perf-types.js";
import type { Logger } from "./types.js";

/** The script that ran longest in a long animation frame. */
export type LoafScriptSummary = {
    invoker : string;
    invokerType : string;
    sourceURL : string;
    sourceFunctionName : string;
    duration : number;
};

export type LoafReport = {
    blockingDuration : number;
    duration : number;
    startTime : number;
    /**
     * Time from the start of the frame's rendering phase (rAF callbacks,
     * style, layout, paint) to the end of the frame. 0 when the frame did not
     * render — browsers report `renderStart = 0` in that case.
     */
    renderDuration : number;
    scriptCount : number;
    hasForceLayout : boolean;
    /** The longest script, or `undefined` if the frame has no script attribution. */
    topScript : LoafScriptSummary | undefined;
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
        const scripts = loaf.scripts ?? [];
        const hasForceLayout = scripts.some(s => s.forcedStyleAndLayoutDuration > 0);
        const longest = scripts.reduce<LoafEntry["scripts"][number] | undefined>(
            (best, s) => (best === undefined || s.duration > best.duration ? s : best), undefined);

        this.report({
            blockingDuration : loaf.blockingDuration,
            duration : loaf.duration,
            startTime : loaf.startTime,
            renderDuration,
            scriptCount : scripts.length,
            hasForceLayout,
            topScript : longest && {
                invoker : longest.invoker,
                invokerType : longest.invokerType,
                sourceURL : longest.sourceURL,
                sourceFunctionName : longest.sourceFunctionName ?? "",
                duration : longest.duration,
            },
        });
    }
}
