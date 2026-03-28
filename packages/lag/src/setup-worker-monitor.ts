import type { Clock, ClearIntervalFn, Logger, SetIntervalFn } from "./types.js";
import { WorkerLagMonitor, type WorkerLagMeasurement, type WorkerLike } from "./WorkerLagMonitor.js";

type Meter = {
    createHistogram : <A>(name : string, options : { unit : string }) => {
        record : (value : number, attributes? : A) => void;
    };
    createObservableGauge : <A>(name : string, options : { unit : string }) => {
        addCallback : (callback : (observableResult : { observe : (value : number, attributes? : A) => void }) => void) => void;
    };
};

type WorkerMonitorDeps = {
    worker : WorkerLike;
    logger : Logger;
    setIntervalFn : SetIntervalFn;
    clearIntervalFn : ClearIntervalFn;
    clock : Clock;
    meter : Meter;
    pingIntervalMs? : number;
};

const DEFAULT_PING_INTERVAL_MS = 5_000;

export function setupWorkerMonitor(deps : WorkerMonitorDeps) : WorkerLagMonitor {
    const {
        worker,
        logger,
        setIntervalFn,
        clearIntervalFn,
        clock,
        meter,
        pingIntervalMs = DEFAULT_PING_INTERVAL_MS,
    } = deps;

    const roundtripHistogram = meter.createHistogram<WorkerLagMeasurement>(
        "lag_worker_roundtrip_histogram",
        { unit : "ms" },
    );
    const mainBlockHistogram = meter.createHistogram<WorkerLagMeasurement>(
        "lag_worker_main_block_histogram",
        { unit : "ms" },
    );
    const workerSelfLagHistogram = meter.createHistogram<WorkerLagMeasurement>(
        "lag_worker_self_lag_histogram",
        { unit : "ms" },
    );

    const roundtripMaxGauge = meter.createObservableGauge<Record<string, never>>(
        "lag_worker_roundtrip_max_gauge",
        { unit : "ms" },
    );
    let maxRoundtrip = 0;
    roundtripMaxGauge.addCallback((result) => {
        if (maxRoundtrip > 0) {
            result.observe(maxRoundtrip);
            maxRoundtrip = 0;
        }
    });

    return new WorkerLagMonitor(
        worker,
        (measurement : WorkerLagMeasurement) => {
            roundtripHistogram.record(measurement.roundTripMs, measurement);
            mainBlockHistogram.record(measurement.estimatedMainBlockMs, measurement);
            workerSelfLagHistogram.record(measurement.workerSelfLagMs, measurement);

            if (measurement.roundTripMs > maxRoundtrip) {
                maxRoundtrip = measurement.roundTripMs;
            }

        },
        logger,
        setIntervalFn,
        clearIntervalFn,
        clock,
        pingIntervalMs,
    );
}
