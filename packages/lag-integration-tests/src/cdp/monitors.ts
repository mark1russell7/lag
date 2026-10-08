import {
    createNoopMeter,
    isVisibleState,
    setupAllMonitors,
    type AllMonitorHandles,
    type EventAttributes,
    type StateTransition,
} from "@lag/core";
import { createLagWorker, type LagWorker } from "@lag/worker";
import { createBrowserDeps, createRecordingLogger, createTeeMeter, type RecordedValue, type TeeMeter } from "../harness.js";

/** The histograms of the monitors that pause while the page is hidden or frozen. */
export const PAUSED_METRICS = [
    "lag_drift_histogram",
    "lag_macrotask_histogram",
    "lag_worker_main_block_histogram",
    "lag_frame_delta_histogram",
    "lag_idle_time_remaining_histogram",
    "lag_scheduling_macrotask_histogram",
] as const;

export type RecordedEvent = { name : string; attributes : EventAttributes; time : number };

export type MonitoredPage = {
    handles : AllMonitorHandles;
    tee : TeeMeter;
    worker : LagWorker;
    events : RecordedEvent[];
    transitions : StateTransition[];
    /** The records of `name` after `time`. */
    after(name : string, time : number) : RecordedValue[];
    /** The records of `name` in the open interval from `start` to `end`. */
    between(name : string, start : number, end : number) : RecordedValue[];
    stop() : void;
};

/** All monitors and a worker, with a tee meter, an event recorder and the lifecycle transitions. */
export function startMonitors(heartbeatIntervalMs = 100) : MonitoredPage {
    const tee = createTeeMeter(createNoopMeter());
    const events : RecordedEvent[] = [];
    const worker = createLagWorker();
    const handles = setupAllMonitors(createBrowserDeps({
        logger : createRecordingLogger(),
        meter : tee.meter,
        worker,
        workerHeartbeatIntervalMs : heartbeatIntervalMs,
        events : { emit : (name, attributes) => events.push({ name, attributes, time : performance.now() }) },
    }));
    const transitions : StateTransition[] = [];
    handles.lifecycleStateMachine!.subscribe(transition => transitions.push(transition));
    return {
        handles,
        tee,
        worker,
        events,
        transitions,
        after : (name, time) => tee.records(name).filter(record => record.time > time),
        between : (name, start, end) => tee.records(name).filter(record => record.time > start && record.time < end),
        stop() {
            handles.stop();
            worker.terminate();
        },
    };
}

/** The time of the first transition to a hidden state, and of the next transition to a visible state. */
export function hiddenInterval(transitions : readonly StateTransition[]) : { hiddenAt : number; visibleAt : number } {
    const hidden = transitions.findIndex(t => !isVisibleState(t.to));
    const visible = transitions.findIndex((t, index) => index > hidden && isVisibleState(t.to));
    if (hidden < 0 || visible < 0) throw new Error(`No hidden interval in ${JSON.stringify(transitions)}`);
    return { hiddenAt : transitions[hidden]!.timestamp, visibleAt : transitions[visible]!.timestamp };
}
