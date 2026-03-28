import { highFrequencyLagIntervalMs, macrotaskLagIntervalMs, maxLagBuffer } from "./constants.js";
import { ContinuousLag } from "./ContinuousLag.js";
import { DriftLag } from "./DriftLag.js";
import { LagLogger } from "./LagLogger.js";
import type { LagMonitor, LagMonitorConstructor } from "./LagMonitor.js";
import { MacrotaskLag } from "./MacrotaskLag.js";
import { PageHiddenTracker, type Document } from "./PageHiddenTracker.js";
import type { ClearIntervalFn, Clock, EventLoopLagAttributes, LagMeasurement, Logger, SetIntervalFn, SetTimeoutFn } from "./types.js";

type Deps = [
    Document,
    Logger,
    SetIntervalFn,
    ClearIntervalFn,
    SetTimeoutFn,
    ClearIntervalFn,
    Clock,
    {
        createHistogram : <A>(name : string, options : {unit : string}) => {
            record : (value : number, attributes : A) => void
        },
        createObservableGauge : <A>(name : string, options : {unit : string}) => {
            addCallback : (callback : (observableResult : ObservableResult<A>) => void) => void
        }
    },
];


export function setupLagMonitors(
    deps : Deps
) : void {
    setupLag(
        'macrotask',
        MacrotaskLag,
        macrotaskLagIntervalMs,
        ...deps
    );
    setupLag(
        'continuous',
        ContinuousLag,
        highFrequencyLagIntervalMs,
        ...deps,
        new LagLogger(
            highFrequencyLagIntervalMs,
            deps[1]
        )
    );
    setupLag(
        'drift',
        DriftLag,
        highFrequencyLagIntervalMs,
        ...deps,
    );
}

type ObservableResult<A> = {
    observe : (value : number, attributes : A) => void
}
function setupLag<T extends LagMonitor>(
    name : string,
    LagClass : LagMonitorConstructor<T>,
    monitorInterval : number,
    document : Document,
    logger : Logger,
    setIntervalFn : SetIntervalFn,
    clearIntervalFn : ClearIntervalFn,
    setTimeoutFn : SetTimeoutFn,
    clearTimeoutFn : ClearIntervalFn,
    clock : Clock,
    meter : {
        createHistogram : <A>(name : string, options : {unit : string}) => {
            record : (value : number, attributes : A) => void
        },
        createObservableGauge : <A>(name : string, options : {unit : string}) => {
            addCallback : (callback : (observableResult : ObservableResult<A>) => void) => void
        }
    },
    lagLogger? : LagLogger,

) : T {
    const pageHiddenTracker = new PageHiddenTracker(
        document
    );

    const lagHistogram = meter.createHistogram<EventLoopLagAttributes>(
        `lag_${name}_histogram`,
        {unit : 'ms'}
    );
    const lagMaxGauge = meter.createObservableGauge<EventLoopLagAttributes>(
        `lag_${name}_max_gauge`,
        {
            unit : 'ms',
        }
    );
    const lagAvgGauge = meter.createObservableGauge<EventLoopLagAttributes>(
        `lag_${name}_avg_gauge`,
        {
            unit : 'ms',
        }
    );
    let max : LagMeasurement | undefined;
    lagMaxGauge.addCallback((observableResult : ObservableResult<EventLoopLagAttributes>) => {
        if(max){
            observableResult.observe(max.value, max.attributes);
        }
    });

    const buffer : LagMeasurement[] = [];
    lagAvgGauge.addCallback((observableResult : ObservableResult<EventLoopLagAttributes>) => {
        if(buffer.length === 0) {
            return;
        }
        const sum = buffer.reduce((acc, measurement) => acc + measurement.value, 0);
        const avg = sum / buffer.length;
        const representativeAttributes = buffer[buffer.length - 1]!.attributes;
        observableResult.observe(avg, representativeAttributes);
        buffer.splice(0, buffer.length);
    });

    return new LagClass(
        monitorInterval,
        (value : number) => {
            const attributes : EventLoopLagAttributes = {
                wasHidden : pageHiddenTracker.getAndReset(),
            };
            if(attributes.wasHidden) {
                return;
            }
            const measurement : LagMeasurement = {
                value,
                attributes,
            };

            lagHistogram.record(value, attributes);
            lagLogger?.addMeasurement(measurement);

            // add to buffer
            buffer.push(measurement);
            if(buffer.length >= maxLagBuffer){
                buffer.shift();
            }

            // update max
            if(!max || value > max.value) {
                max = measurement;
            }
        },
        logger,
        setIntervalFn,
        clearIntervalFn,
        setTimeoutFn,
        clearTimeoutFn,
        clock
    );


}