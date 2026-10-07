import type { Meter, MetricNames, MonitorLogEntry, StartedMonitors } from "../adapters/lag-core";
import type { LoadActionId, ProfileId, ProfileRun } from "../adapters/lag-load";
import { downsampleMax, percentile, sortedValues } from "../lib/stats";
import { LiveMeter } from "./live-meter";

/** `full`: every monitor and a worker (the playground). `timers`: only the timer monitors (the home page). */
export type SessionKind = "full" | "timers";

/** Starts the monitors. The browser runtime calls `setupAllMonitors`; a test gives a fake. */
export type MonitorRuntime = {
    readonly metrics : MetricNames;
    start(meter : Meter, onLog : (entry : MonitorLogEntry) => void) : StartedMonitors;
};

/** Runs synthetic load. The browser runtime calls `@lag/load`; a test gives a fake. */
export type LoadRunner = {
    run(id : LoadActionId) : Promise<void>;
    runProfile(id : ProfileId, durationMs : number, signal : AbortSignal) : Promise<ProfileRun>;
};

export type SessionScheduler = {
    /** The clock, in ms. */
    now() : number;
    setInterval(callback : () => void, ms : number) : unknown;
    clearInterval(handle : unknown) : void;
};

export type SessionStatus = "idle" | "running" | "stopped" | "failed";

export type SeriesPoint = {
    /** Seconds since the session started. */
    t : number;
    value : number;
};

export type LiveSeries = {
    points : readonly SeriesPoint[];
    /** The number of values in the time window. */
    count : number;
    latest : number | undefined;
    p95 : number | undefined;
    max : number | undefined;
};

export type ActiveLoad =
    | { kind : "action"; id : LoadActionId; startedAt : number }
    | { kind : "profile"; id : ProfileId; startedAt : number; durationMs : number };

export type LoadRecord = {
    kind : "action" | "profile";
    id : string;
    /** Seconds since the session started. */
    startedAt : number;
    durationMs : number;
    aborted : boolean;
};

export type LogRecord = {
    /** Seconds since the session started. */
    t : number;
    level : string;
    message : string;
};

export type LifecycleTransition = {
    from : string;
    to : string;
    trigger : string;
};

/** What the playground shows. A new object for each update, so React can compare it. */
export type PlaygroundSnapshot = {
    status : SessionStatus;
    error : string | undefined;
    elapsedSeconds : number;
    windowSeconds : number;
    series : {
        drift : LiveSeries;
        workerBlock : LiveSeries;
        frameDelta : LiveSeries;
        eventDuration : LiveSeries;
    };
    gcEvents : number;
    lifecycleTransitions : number;
    lifecycleState : string | undefined;
    lastTransition : LifecycleTransition | undefined;
    workerRunning : boolean;
    /** The time (ms) that the active load started, from the session clock. */
    activeLoad : ActiveLoad | undefined;
    history : readonly LoadRecord[];
    log : readonly LogRecord[];
};

export type PlaygroundSessionOptions = {
    runtime : MonitorRuntime;
    loads? : LoadRunner;
    scheduler : SessionScheduler;
    /** How often the session makes a snapshot. The default is 500 ms (2 updates each second). */
    snapshotIntervalMs? : number;
    /** The time window of the series. The default is 30 s. */
    windowMs? : number;
    /** The maximum number of points in a series. */
    maxPoints? : number;
    meterCapacity? : number;
};

const HISTORY_LIMIT = 12;
const LOG_LIMIT = 50;

const EMPTY_SERIES : LiveSeries = { points : [], count : 0, latest : undefined, p95 : undefined, max : undefined };

function toText(value : unknown) : string {
    return value === undefined || value === null ? "" : String(value);
}

/**
 * A live demo session. It owns a `LiveMeter`, the monitors (through the
 * runtime) and their worker. It has no React code: components subscribe to
 * snapshots and render them.
 */
export class PlaygroundSession {
    private readonly listeners = new Set<() => void>();
    private readonly snapshotIntervalMs : number;
    private readonly windowMs : number;
    private readonly maxPoints : number;
    private status : SessionStatus = "idle";
    private error : string | undefined;
    private meter : LiveMeter | undefined;
    private started : StartedMonitors | undefined;
    private timer : unknown;
    private startedAt = 0;
    private activeLoad : ActiveLoad | undefined;
    private profileAbort : AbortController | undefined;
    private history : LoadRecord[] = [];
    private log : LogRecord[] = [];
    private snapshot : PlaygroundSnapshot;

    constructor(private readonly options : PlaygroundSessionOptions) {
        this.snapshotIntervalMs = options.snapshotIntervalMs ?? 500;
        this.windowMs = options.windowMs ?? 30_000;
        this.maxPoints = options.maxPoints ?? 300;
        this.snapshot = this.buildSnapshot();
    }

    /** For `useSyncExternalStore`. Returns the unsubscribe function. */
    readonly subscribe = (listener : () => void) : (() => void) => {
        this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    };

    /** For `useSyncExternalStore`. The same object until the next update. */
    readonly getSnapshot = () : PlaygroundSnapshot => this.snapshot;

    /** The meter of the current run. */
    get liveMeter() : LiveMeter | undefined {
        return this.meter;
    }

    get canRunLoad() : boolean {
        return this.status === "running" && this.options.loads !== undefined && this.activeLoad === undefined;
    }

    start() : void {
        if (this.status === "running") return;
        const { scheduler, runtime } = this.options;
        const meter = new LiveMeter({ now : () => scheduler.now(), ...(this.options.meterCapacity ? { capacity : this.options.meterCapacity } : {}) });
        this.meter = meter;
        this.startedAt = scheduler.now();
        this.history = [];
        this.log = [];
        this.error = undefined;
        try {
            this.started = runtime.start(meter, (entry) => this.addLog(entry));
        } catch (error) {
            this.status = "failed";
            this.error = error instanceof Error ? error.message : String(error);
            this.publish();
            return;
        }
        this.status = "running";
        this.timer = scheduler.setInterval(() => this.tick(), this.snapshotIntervalMs);
        this.publish();
    }

    /** Stops the monitors (`stop()` on the handles) and terminates the worker. */
    stop() : void {
        if (this.status !== "running") return;
        this.options.scheduler.clearInterval(this.timer);
        this.timer = undefined;
        this.profileAbort?.abort();
        const started = this.started;
        this.started = undefined;
        try {
            started?.handles.stop();
        } finally {
            started?.worker?.terminate();
        }
        this.status = "stopped";
        this.publish();
    }

    /** Stops the session and removes every listener. */
    dispose() : void {
        this.stop();
        this.listeners.clear();
    }

    /** Runs one load action. The session ignores the call if it is not running or a load is active. */
    async runLoad(id : LoadActionId) : Promise<void> {
        const loads = this.options.loads;
        if (!loads || !this.canRunLoad) return;
        const startedAt = this.options.scheduler.now();
        this.activeLoad = { kind : "action", id, startedAt };
        this.publish();
        try {
            await loads.run(id);
        } finally {
            this.finishLoad("action", id, startedAt, false);
        }
    }

    /** Runs a workload profile. `stopProfile()` stops it early. */
    async runProfile(id : ProfileId, durationMs = 10_000) : Promise<ProfileRun | undefined> {
        const loads = this.options.loads;
        if (!loads || !this.canRunLoad) return undefined;
        const startedAt = this.options.scheduler.now();
        const abort = new AbortController();
        this.profileAbort = abort;
        this.activeLoad = { kind : "profile", id, startedAt, durationMs };
        this.publish();
        let aborted = false;
        try {
            const run = await loads.runProfile(id, durationMs, abort.signal);
            aborted = run.aborted;
            return run;
        } finally {
            if (this.profileAbort === abort) this.profileAbort = undefined;
            this.finishLoad("profile", id, startedAt, aborted || abort.signal.aborted);
        }
    }

    stopProfile() : void {
        this.profileAbort?.abort();
    }

    private finishLoad(kind : LoadRecord["kind"], id : string, startedAt : number, aborted : boolean) : void {
        const now = this.options.scheduler.now();
        this.activeLoad = undefined;
        this.history = [
            { kind, id, startedAt : (startedAt - this.startedAt) / 1000, durationMs : now - startedAt, aborted },
            ...this.history,
        ].slice(0, HISTORY_LIMIT);
        this.publish();
    }

    private addLog(entry : MonitorLogEntry) : void {
        const t = (this.options.scheduler.now() - this.startedAt) / 1000;
        this.log = [{ t, level : entry.level, message : entry.message }, ...this.log].slice(0, LOG_LIMIT);
    }

    private tick() : void {
        this.meter?.collect();
        this.publish();
    }

    private publish() : void {
        this.snapshot = this.buildSnapshot();
        for (const listener of [...this.listeners]) listener();
    }

    private series(name : string, now : number) : LiveSeries {
        const meter = this.meter;
        if (!meter) return EMPTY_SERIES;
        const samples = meter.samplesSince(name, now - this.windowMs);
        if (samples.length === 0) return EMPTY_SERIES;
        const sorted = sortedValues(samples.map(sample => sample.value));
        const points = samples.map(sample => ({ t : (sample.t - this.startedAt) / 1000, value : sample.value }));
        return {
            points : downsampleMax(points, this.maxPoints),
            count : samples.length,
            latest : samples[samples.length - 1]?.value,
            p95 : percentile(sorted, 95),
            max : sorted[sorted.length - 1],
        };
    }

    private buildSnapshot() : PlaygroundSnapshot {
        const now = this.options.scheduler.now();
        const { metrics } = this.options.runtime;
        const meter = this.meter;
        const transition = meter?.latest(metrics.lifecycleTransitions)?.attributes;
        return {
            status : this.status,
            error : this.error,
            elapsedSeconds : this.status === "idle" ? 0 : (now - this.startedAt) / 1000,
            windowSeconds : this.windowMs / 1000,
            series : {
                drift : this.series(metrics.driftLag, now),
                workerBlock : this.series(metrics.workerMainBlock, now),
                frameDelta : this.series(metrics.frameDelta, now),
                eventDuration : this.series(metrics.eventDuration, now),
            },
            gcEvents : meter?.read(metrics.gcEvents)?.total ?? 0,
            lifecycleTransitions : meter?.read(metrics.lifecycleTransitions)?.total ?? 0,
            lifecycleState : this.started?.lifecycleState(),
            lastTransition : transition
                ? { from : toText(transition["from"]), to : toText(transition["to"]), trigger : toText(transition["trigger"]) }
                : undefined,
            workerRunning : this.started?.worker !== undefined,
            activeLoad : this.activeLoad,
            history : this.history,
            log : this.log,
        };
    }
}
