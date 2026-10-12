/**
 * The API of the page on `window.e8`. The runner controls the page through
 * it: the runner waits in Node.js, thus the page is idle between the calls.
 * The monitors record into a meter in memory, thus nothing goes to the
 * network.
 */
import {
    MacrotaskLag,
    METRICS,
    SchedulingFairnessMonitor,
    createBrowserDeps,
    createMessageTaskQueue,
    setupAllMonitors,
    type AllMonitorDeps,
    type AllMonitorHandles,
    type Attributes,
    type Logger,
    type Meter,
} from "@mark1russell7/lag";
import { createLagWorker, type LagWorker } from "@mark1russell7/lag/worker";
import { syncBusyWait } from "@lag/load";
import type { ContextManagerOption } from "@mark1russell7/otel-ts";
import {
    BLOCKING_TASK_MS,
    CLICK_HANDLER_MS,
    CLICK_TARGET,
    type ClickReadings,
    type E8Page,
    type LoafReadings,
    type LoafScript,
    type ProbeReadings,
    type SetupId,
} from "../shared/types.js";
import { checkContext } from "./correctness.js";
import { runWorkload } from "./workloads.js";

declare global {
    interface Window {
        e8? : E8Page;
    }
}

type Recorded = { value : number; time : number };

/** A meter that keeps each value with the time of the record. */
function createRecordingMeter() : { meter : Meter; values(name : string, since : number) : number[] } {
    const recorded = new Map<string, Recorded[]>();
    const recordsOf = (name : string) : Recorded[] => {
        const records = recorded.get(name) ?? [];
        recorded.set(name, records);
        return records;
    };
    const meter : Meter = {
        createHistogram<A extends Attributes>(name : string) {
            const records = recordsOf(name);
            return { record : (value : number, _attributes? : A) => { records.push({ value, time : performance.now() }); } };
        },
        createCounter<A extends Attributes>(name : string) {
            const records = recordsOf(name);
            return { add : (value : number, _attributes? : A) => { records.push({ value, time : performance.now() }); } };
        },
    };
    return {
        meter,
        values : (name, since) => (recorded.get(name) ?? []).filter(record => record.time >= since).map(record => record.value),
    };
}

/** A logger that writes the errors to the console. The runner collects the console errors. */
const logger : Logger = {
    log(level, message, args) {
        if (level === "error") console.error(`[lag] ${message}`, args);
    },
};

type TimedEntry<T> = { startTime : number; entry : T };

type EventEntry = PerformanceEntry & { interactionId? : number };
type LoafEntry = PerformanceEntry & {
    blockingDuration : number;
    scripts? : ReadonlyArray<{ invoker : string; invokerType : string; sourceFunctionName? : string; sourceURL : string; duration : number }>;
};

function supports(type : string) : boolean {
    return typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes(type);
}

/** This function keeps the entries of one type from the start of the page. */
function observeEntries<T extends PerformanceEntry>(type : string, options : PerformanceObserverInit = {}) : Array<TimedEntry<T>> {
    const entries : Array<TimedEntry<T>> = [];
    if (!supports(type)) return entries;
    new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) entries.push({ startTime : entry.startTime, entry : entry as T });
    }).observe({ type, buffered : true, ...options });
    return entries;
}

function longestScript(entry : LoafEntry) : LoafScript | undefined {
    const longest = (entry.scripts ?? []).reduce<NonNullable<LoafEntry["scripts"]>[number] | undefined>(
        (best, script) => (best === undefined || script.duration > best.duration ? script : best), undefined);
    return longest && {
        invoker : longest.invoker,
        invokerType : longest.invokerType,
        sourceFunctionName : longest.sourceFunctionName ?? "",
        sourceURL : longest.sourceURL,
        duration : longest.duration,
    };
}

/** This function makes the API of the page. */
export function createE8Page(setup : SetupId, contextManager : ContextManagerOption) : E8Page {
    const recording = createRecordingMeter();
    const events = observeEntries<EventEntry>("event", { durationThreshold : 16 } as PerformanceObserverInit);
    const frames = observeEntries<LoafEntry>("long-animation-frame");

    document.querySelector(CLICK_TARGET)?.addEventListener("click", function fixedClickHandler() {
        void syncBusyWait(CLICK_HANDLER_MS);
    });

    let deps : AllMonitorDeps | undefined;
    let handles : AllMonitorHandles | undefined;
    let worker : LagWorker | undefined;
    let probes : { stop() : void; readings : ProbeReadings } | undefined;

    return {
        ready : true,
        facts : () => ({
            setup,
            contextManager : typeof contextManager === "string" ? contextManager : contextManager.constructor.name,
            zoneLoaded : typeof (globalThis as { Zone? : unknown }).Zone !== "undefined",
            // Not the full key of the store: the size check of the builds searches for the full key
            asyncContextInstalled : Object.getOwnPropertySymbols(globalThis).some(symbol => symbol.description?.startsWith("async-browser-context/") === true),
            userAgent : navigator.userAgent,
        }),
        now : () => performance.now(),
        startMonitors() {
            worker = createLagWorker();
            deps = createBrowserDeps(window, { logger, meter : recording.meter, worker });
            handles = setupAllMonitors(deps);
        },
        stopMonitors() {
            probes?.stop();
            handles?.stop();
            worker?.terminate();
            handles = undefined;
            worker = undefined;
        },
        idleReadings : (since) => ({ drift : recording.values(METRICS.drift.name, since) }),
        startProbes(intervalMs) {
            if (!deps?.MessageChannel || !deps.queueMicrotask) throw new Error("The probes need MessageChannel and queueMicrotask.");
            const readings : ProbeReadings = { macrotask : [], microtask : [], schedulingMacrotask : [], messageChannel : [] };
            const tasks = createMessageTaskQueue(deps.MessageChannel);
            // The monitors of the setup sample each 5 s. These probes are the same classes with a shorter interval.
            const macrotask = new MacrotaskLag(
                intervalMs,
                (value) => { readings.macrotask.push(Math.max(0, value)); },
                logger,
                deps.setIntervalFn,
                deps.clearIntervalFn,
                deps.setTimeoutFn,
                deps.clearTimeoutFn,
                deps.clock,
                (callback) => tasks.post(callback),
            );
            const scheduling = new SchedulingFairnessMonitor(
                intervalMs,
                (measurement) => {
                    readings.microtask.push(measurement.microtaskMs);
                    readings.schedulingMacrotask.push(measurement.macrotaskMs);
                    readings.messageChannel.push(measurement.messageChannelMs);
                },
                logger,
                deps.setIntervalFn,
                deps.clearIntervalFn,
                deps.setTimeoutFn,
                deps.queueMicrotask,
                deps.MessageChannel,
                deps.clock,
            );
            probes = {
                readings,
                stop() {
                    macrotask.stop();
                    scheduling.stop();
                    tasks.close();
                },
            };
        },
        stopProbes() {
            if (!probes) throw new Error("The probes did not start.");
            probes.stop();
            const { readings } = probes;
            probes = undefined;
            return readings;
        },
        clickReadings(since) : ClickReadings {
            const durations = new Map<number, number>();
            for (const { startTime, entry } of events) {
                const id = entry.interactionId ?? 0;
                if (startTime < since || id === 0) continue;
                durations.set(id, Math.max(durations.get(id) ?? 0, entry.duration));
            }
            return {
                lagInpMs : handles?.vitals?.getValues().find(value => value.name === "INP")?.value,
                interactionMs : [...durations.values()],
                eventDurationMs : recording.values(METRICS.eventDuration.name, since),
            };
        },
        blockTask(ms) {
            setTimeout(function fixedBlockingTask() {
                void syncBusyWait(ms);
            }, 0);
        },
        loafReadings(since) : LoafReadings {
            const blocking = frames.filter(({ startTime, entry }) => startTime >= since && entry.duration >= BLOCKING_TASK_MS - 10);
            return {
                supported : supports("long-animation-frame"),
                blockingMs : recording.values(METRICS.loafBlocking.name, since),
                topScripts : blocking.map(({ entry }) => longestScript(entry)).filter(script => script !== undefined),
            };
        },
        runWorkload : (name) => runWorkload(name),
        correctness : () => checkContext(),
    };
}
