import { EventTimingMonitor, type EventTimingReport } from "./EventTimingMonitor.js";
import { LayoutShiftMonitor, type LayoutShiftReport } from "./LayoutShiftMonitor.js";
import { LongAnimationFrameMonitor, type LoafReport } from "./LongAnimationFrameMonitor.js";
import type { PerformanceObserverInit } from "./perf-types.js";
import type { Logger } from "./types.js";

type Meter = {
    createHistogram : <A>(name : string, options : { unit : string }) => {
        record : (value : number, attributes? : A) => void;
    };
    createObservableGauge : <A>(name : string, options : { unit : string }) => {
        addCallback : (callback : (observableResult : { observe : (value : number, attributes? : A) => void }) => void) => void;
    };
};

type ObserverMonitorDeps = {
    logger : Logger;
    PerformanceObserver : PerformanceObserverInit;
    meter : Meter;
};

export type ObserverMonitorHandles = {
    loaf : LongAnimationFrameMonitor | undefined;
    eventTiming : EventTimingMonitor | undefined;
    layoutShift : LayoutShiftMonitor | undefined;
    stop() : void;
};

export function setupObserverMonitors(deps : ObserverMonitorDeps) : ObserverMonitorHandles {
    const { logger, PerformanceObserver, meter } = deps;

    let loaf : LongAnimationFrameMonitor | undefined;
    let eventTiming : EventTimingMonitor | undefined;
    let layoutShift : LayoutShiftMonitor | undefined;

    // --- Long Animation Frame ---
    try {
        const loafBlockingHistogram = meter.createHistogram<LoafReport>(
            "lag_loaf_blocking_histogram",
            { unit : "ms" },
        );
        const loafDurationHistogram = meter.createHistogram<LoafReport>(
            "lag_loaf_duration_histogram",
            { unit : "ms" },
        );

        loaf = new LongAnimationFrameMonitor(
            (entry : LoafReport) => {
                loafBlockingHistogram.record(entry.blockingDuration, entry);
                loafDurationHistogram.record(entry.duration, entry);
            },
            logger,
            PerformanceObserver,
        );
    } catch (error) {
        logger.log("warn", "Failed to create LongAnimationFrameMonitor.", { error });
    }

    // --- Event Timing (INP) ---
    try {
        const inpHistogram = meter.createHistogram<EventTimingReport>(
            "lag_inp_histogram",
            { unit : "ms" },
        );
        const inpInputDelayHistogram = meter.createHistogram<EventTimingReport>(
            "lag_inp_input_delay_histogram",
            { unit : "ms" },
        );
        const inpProcessingHistogram = meter.createHistogram<EventTimingReport>(
            "lag_inp_processing_histogram",
            { unit : "ms" },
        );
        const inpPresentationHistogram = meter.createHistogram<EventTimingReport>(
            "lag_inp_presentation_delay_histogram",
            { unit : "ms" },
        );

        let currentEventTiming : EventTimingMonitor | undefined;

        const inpGauge = meter.createObservableGauge<Record<string, never>>(
            "lag_inp_worst_gauge",
            { unit : "ms" },
        );
        inpGauge.addCallback((result) => {
            if (currentEventTiming) {
                result.observe(currentEventTiming.getINP());
            }
        });

        eventTiming = new EventTimingMonitor(
            (entry : EventTimingReport) => {
                inpHistogram.record(entry.duration, entry);
                inpInputDelayHistogram.record(entry.inputDelay, entry);
                inpProcessingHistogram.record(entry.processingDuration, entry);
                inpPresentationHistogram.record(entry.presentationDelay, entry);
            },
            logger,
            PerformanceObserver,
        );
        currentEventTiming = eventTiming;
    } catch (error) {
        logger.log("warn", "Failed to create EventTimingMonitor.", { error });
    }

    // --- Layout Shift (CLS) ---
    try {
        const clsHistogram = meter.createHistogram<LayoutShiftReport>(
            "lag_cls_shift_histogram",
            { unit : "score" },
        );

        let currentLayoutShift : LayoutShiftMonitor | undefined;

        const clsGauge = meter.createObservableGauge<Record<string, never>>(
            "lag_cls_worst_session_gauge",
            { unit : "score" },
        );
        clsGauge.addCallback((result) => {
            if (currentLayoutShift) {
                result.observe(currentLayoutShift.getCLS());
            }
        });

        layoutShift = new LayoutShiftMonitor(
            (entry : LayoutShiftReport) => {
                clsHistogram.record(entry.value, entry);
            },
            logger,
            PerformanceObserver,
        );
        currentLayoutShift = layoutShift;
    } catch (error) {
        logger.log("warn", "Failed to create LayoutShiftMonitor.", { error });
    }

    return {
        loaf,
        eventTiming,
        layoutShift,
        stop() {
            loaf?.stop();
            eventTiming?.stop();
            layoutShift?.stop();
        },
    };
}
