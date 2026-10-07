import type { CoreDeps, ObserverDeps, PerformanceDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { EventTimingMonitor, interactionType } from "../EventTimingMonitor.js";
import { METRICS, createHistogram } from "../metric-catalog.js";
import { createHandle } from "./shared.js";

type InteractionAttributes = { interaction : ReturnType<typeof interactionType> };

/**
 * Constructs an EventTimingMonitor wired to four histograms. Each interaction
 * event of 16 ms or more adds one sample to each, labeled with the
 * interaction type (`pointer`, `keyboard` or `other`).
 *
 * INP for each page view comes from the page-view vitals
 * (`createInstrumentedPageViewVitals`), not from this factory.
 */
export function createInstrumentedEventTiming(
    deps : CoreDeps & ObserverDeps & Partial<PerformanceDeps>,
) : MonitorHandle<EventTimingMonitor> {
    return createHandle("event-timing", deps.logger, () => {
        const durationHist = createHistogram<InteractionAttributes>(deps.meter, METRICS.eventDuration);
        const inputDelayHist = createHistogram<InteractionAttributes>(deps.meter, METRICS.eventInputDelay);
        const processingHist = createHistogram<InteractionAttributes>(deps.meter, METRICS.eventProcessing);
        const presentationHist = createHistogram<InteractionAttributes>(deps.meter, METRICS.eventPresentationDelay);
        const performance = deps.performance;

        const monitor = new EventTimingMonitor(
            (entry) => {
                const attributes = { interaction : interactionType(entry.name) };
                durationHist.record(entry.duration, attributes);
                inputDelayHist.record(Math.max(0, entry.inputDelay), attributes);
                processingHist.record(Math.max(0, entry.processingDuration), attributes);
                presentationHist.record(entry.presentationDelay, attributes);
            },
            deps.logger,
            deps.PerformanceObserver,
            performance ? () => performance.interactionCount : undefined,
        );

        return { monitor, stop : () => monitor.stop() };
    });
}
