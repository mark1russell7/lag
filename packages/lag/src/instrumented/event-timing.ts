import type { CoreDeps, ObserverDeps } from "../dep-groups.js";
import type { MonitorHandle } from "../monitor-handle.js";
import { EventTimingMonitor } from "../EventTimingMonitor.js";
import { createHandle, observe } from "./shared.js";

/**
 * Constructs an EventTimingMonitor wired to four histograms + one INP gauge.
 *
 * Metrics (all ms, one sample per interaction event ≥16ms):
 * - `lag_inp_histogram` — event duration
 * - `lag_inp_input_delay_histogram` — delay before handlers run
 * - `lag_inp_processing_histogram` — handler execution time
 * - `lag_inp_presentation_delay_histogram` — handlers done → next paint
 * - `lag_inp_worst_gauge` — current INP for the page
 */
export function createInstrumentedEventTiming(
    deps : CoreDeps & ObserverDeps,
) : MonitorHandle<EventTimingMonitor> {
    return createHandle("event-timing", deps.logger, () => {
        const inpHist = deps.meter.createHistogram("lag_inp_histogram", { unit : "ms" });
        const inputDelayHist = deps.meter.createHistogram("lag_inp_input_delay_histogram", { unit : "ms" });
        const processingHist = deps.meter.createHistogram("lag_inp_processing_histogram", { unit : "ms" });
        const presentationHist = deps.meter.createHistogram("lag_inp_presentation_delay_histogram", { unit : "ms" });

        const monitor = new EventTimingMonitor(
            (entry) => {
                inpHist.record(entry.duration);
                inputDelayHist.record(entry.inputDelay);
                processingHist.record(entry.processingDuration);
                presentationHist.record(entry.presentationDelay);
            },
            deps.logger,
            deps.PerformanceObserver,
        );

        const unobserve = observe(
            deps.meter.createObservableGauge("lag_inp_worst_gauge", { unit : "ms" }),
            (result) => {
                const inp = monitor.getINP();
                if (inp > 0) result.observe(inp);
            },
        );

        return {
            monitor,
            stop : () => {
                unobserve();
                monitor.stop();
            },
        };
    });
}
