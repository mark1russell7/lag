import type { CoreDeps, ObserverDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { EventTimingMonitor, type EventTimingReport } from "../EventTimingMonitor.js";

/**
 * Constructs an EventTimingMonitor wired to four histograms + one INP gauge.
 *
 * Metrics:
 * - `lag_inp_histogram` — interaction duration (INP raw samples)
 * - `lag_inp_input_delay_histogram` — delay before handler runs
 * - `lag_inp_processing_histogram` — handler execution time
 * - `lag_inp_presentation_delay_histogram` — commit/paint delay after handler
 * - `lag_inp_worst_gauge` — current worst-case INP (p98 approximation)
 */
export function createInstrumentedEventTiming(
    deps : CoreDeps & ObserverDeps,
) : MonitorHandle<EventTimingMonitor> {
    try {
        const inpHist = deps.meter.createHistogram<EventTimingReport>(
            "lag_inp_histogram", { unit : "ms" });
        const inputDelayHist = deps.meter.createHistogram<EventTimingReport>(
            "lag_inp_input_delay_histogram", { unit : "ms" });
        const processingHist = deps.meter.createHistogram<EventTimingReport>(
            "lag_inp_processing_histogram", { unit : "ms" });
        const presentationHist = deps.meter.createHistogram<EventTimingReport>(
            "lag_inp_presentation_delay_histogram", { unit : "ms" });
        const worstGauge = deps.meter.createObservableGauge<Record<string, never>>(
            "lag_inp_worst_gauge", { unit : "ms" });

        const monitor = new EventTimingMonitor(
            (entry) => {
                inpHist.record(entry.duration, entry);
                inputDelayHist.record(entry.inputDelay, entry);
                processingHist.record(entry.processingDuration, entry);
                presentationHist.record(entry.presentationDelay, entry);
            },
            deps.logger,
            deps.PerformanceObserver,
        );

        worstGauge.addCallback((result) => {
            result.observe(monitor.getINP());
        });

        return { name : "event-timing", monitor, stop : () => monitor.stop() };
    } catch (error) {
        deps.logger.log("warn", "Failed to create EventTimingMonitor.", {
            error,
            type : "createInstrumentedEventTiming",
        });
        return { name : "event-timing", monitor : undefined, stop : () => {} };
    }
}
