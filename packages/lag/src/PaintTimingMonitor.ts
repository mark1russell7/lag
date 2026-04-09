import { ObserverMonitor } from "./ObserverMonitor.js";
import type { PerformanceEntryLike, PerformanceObserverInit, PaintEntry } from "./perf-types.js";
import type { Logger } from "./types.js";

export type PaintReport = {
    name : string;       // "first-paint" or "first-contentful-paint"
    startTime : number;  // ms since navigation start
};

/**
 * Observes the "paint" entry type, which fires once each for:
 * - first-paint (FP): when any pixel is rendered
 * - first-contentful-paint (FCP): when first text/image is rendered
 *
 * Both are key web vitals. They fire exactly once per page load.
 */
export class PaintTimingMonitor extends ObserverMonitor {
    private firstPaint = -1;
    private firstContentfulPaint = -1;

    constructor(
        private readonly report : (entry : PaintReport) => void,
        logger : Logger,
        PerformanceObserverCtor : PerformanceObserverInit,
    ) {
        super("paint", logger, PerformanceObserverCtor);
    }

    protected processEntry(entry : PerformanceEntryLike) : void {
        const paint = entry as PaintEntry;

        if (paint.name === "first-paint") {
            this.firstPaint = paint.startTime;
        } else if (paint.name === "first-contentful-paint") {
            this.firstContentfulPaint = paint.startTime;
        }

        this.report({
            name : paint.name,
            startTime : paint.startTime,
        });
    }

    getFirstPaint() : number {
        return this.firstPaint;
    }

    getFirstContentfulPaint() : number {
        return this.firstContentfulPaint;
    }
}
