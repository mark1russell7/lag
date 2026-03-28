import type { ClearIntervalFn, Clock, Logger, SetIntervalFn, SetTimeoutFn } from "./types.js";
import type { Document } from "./PageHiddenTracker.js";
import type { PerformanceObserverInit } from "./perf-types.js";
import type { WorkerLike } from "./WorkerLagMonitor.js";
import type { PerformanceLike } from "./ClockReliabilityChecker.js";
import type { PageLifecycleDocument, PageLifecycleWindow } from "./PageLifecycleTracker.js";
import { setupLagMonitors } from "./setup-lag-monitors.js";
import { setupObserverMonitors, type ObserverMonitorHandles } from "./setup-observer-monitors.js";
import { setupWorkerMonitor } from "./setup-worker-monitor.js";
import { WorkerLagMonitor } from "./WorkerLagMonitor.js";
import { PageLifecycleTracker } from "./PageLifecycleTracker.js";
import { TimerThrottleDetector } from "./TimerThrottleDetector.js";
import { ClockReliabilityChecker } from "./ClockReliabilityChecker.js";
import { GCSpikeDetector } from "./GCSpikeDetector.js";

type Meter = {
    createHistogram : <A>(name : string, options : { unit : string }) => {
        record : (value : number, attributes? : A) => void;
    };
    createObservableGauge : <A>(name : string, options : { unit : string }) => {
        addCallback : (callback : (observableResult : { observe : (value : number, attributes? : A) => void }) => void) => void;
    };
};

export type AllMonitorDeps = {
    document : Document;
    logger : Logger;
    setIntervalFn : SetIntervalFn;
    clearIntervalFn : ClearIntervalFn;
    setTimeoutFn : SetTimeoutFn;
    clearTimeoutFn : ClearIntervalFn;
    clock : Clock;
    meter : Meter;

    // Optional: Performance Observer support
    PerformanceObserver? : PerformanceObserverInit;

    // Optional: Worker support
    worker? : WorkerLike;
    workerPingIntervalMs? : number;

    // Optional: Enhanced lifecycle tracking
    window? : PageLifecycleWindow;
    performance? : PerformanceLike;
};

export type AllMonitorHandles = {
    observers : ObserverMonitorHandles | undefined;
    workerMonitor : WorkerLagMonitor | undefined;
    lifecycleTracker : PageLifecycleTracker | undefined;
    throttleDetector : TimerThrottleDetector | undefined;
    clockChecker : ClockReliabilityChecker | undefined;
    gcDetector : GCSpikeDetector;
    stop() : void;
};

export function setupAllMonitors(deps : AllMonitorDeps) : AllMonitorHandles {
    const {
        document,
        logger,
        setIntervalFn,
        clearIntervalFn,
        setTimeoutFn,
        clearTimeoutFn,
        clock,
        meter,
    } = deps;

    // 1. Always set up the existing timer-based monitors (unchanged behavior)
    setupLagMonitors([
        document,
        logger,
        setIntervalFn,
        clearIntervalFn,
        setTimeoutFn,
        clearTimeoutFn,
        clock,
        meter,
    ]);

    // 2. Performance Observer monitors (optional)
    let observers : ObserverMonitorHandles | undefined;
    if (deps.PerformanceObserver) {
        observers = setupObserverMonitors({
            logger,
            PerformanceObserver : deps.PerformanceObserver,
            meter,
        });
    }

    // 3. Worker monitor (optional)
    let workerMonitor : WorkerLagMonitor | undefined;
    if (deps.worker) {
        workerMonitor = setupWorkerMonitor({
            worker : deps.worker,
            logger,
            setIntervalFn,
            clearIntervalFn,
            clock,
            meter,
            ...(deps.workerPingIntervalMs !== undefined && { pingIntervalMs : deps.workerPingIntervalMs }),
        });
    }

    // 4. Enhanced lifecycle tracking (optional)
    let lifecycleTracker : PageLifecycleTracker | undefined;
    if (deps.window) {
        lifecycleTracker = new PageLifecycleTracker(
            deps.document as PageLifecycleDocument,
            deps.window,
            logger,
        );
    }

    // 5. Timer throttle detection (optional, but cheap)
    let throttleDetector : TimerThrottleDetector | undefined;
    throttleDetector = new TimerThrottleDetector(setTimeoutFn, clock, logger);
    throttleDetector.start();

    // 6. Clock reliability (optional)
    let clockChecker : ClockReliabilityChecker | undefined;
    if (deps.performance) {
        clockChecker = new ClockReliabilityChecker(deps.performance);
    }

    // 7. GC spike detection (always available, pure math)
    const gcDetector = new GCSpikeDetector();

    return {
        observers,
        workerMonitor,
        lifecycleTracker,
        throttleDetector,
        clockChecker,
        gcDetector,
        stop() {
            observers?.stop();
            workerMonitor?.stop();
            throttleDetector?.stop();
        },
    };
}
