import { vi, expect } from "vitest";
import { setupAllMonitors, type AllMonitorDeps, type AllMonitorHandles } from "./setup-all-monitors.js";
import { createWorkerHandler } from "./lag-worker.js";
import { createRecordingMeter } from "./test-utils.js";
import type {
    EventTimingEntry,
    LayoutShiftEntry,
    LcpEntry,
    LoafEntry,
    PerformanceEntryLike,
    PerformanceEntryList,
    PerformanceObserverInstance,
} from "./perf-types.js";
import type { WorkerLike } from "./WorkerLagMonitor.js";
import type { WorkerToMainMessage } from "./worker-protocol.js";
import type { FinalizationRegistryConstructor } from "./GCSignalDetector.js";
import type { PressureObserverInit, PressureRecord } from "./ComputePressureMonitor.js";
import type { MessageChannelConstructor, MessagePortLike } from "./SchedulingFairnessMonitor.js";

type Listener = (event : unknown) => void;

function createEventTarget() {
    const listeners = new Map<string, Set<Listener>>();
    return {
        addEventListener(type : string, listener : Listener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)!.add(listener);
        },
        removeEventListener(type : string, listener : Listener) {
            listeners.get(type)?.delete(listener);
        },
        dispatch(type : string, event? : unknown) {
            for (const listener of [...(listeners.get(type) ?? [])]) listener(event);
        },
        listenerCount() {
            return [...listeners.values()].reduce((n, set) => n + set.size, 0);
        },
    };
}

/**
 * Every browser capability setupAllMonitors can use, faked on top of
 * vitest's fake timers. `lagMs` shifts the main-thread clock forward to
 * simulate the main thread falling behind.
 */
function createFakeBrowser() {
    const TIME_ORIGIN = 1_700_000_000_000;
    let lagMs = 0;
    const mainNow = () => Date.now() + lagMs;

    const document = Object.assign(createEventTarget(), {
        visibilityState : "visible",
        hasFocus : () => true,
    });
    const window = createEventTarget();
    const setVisibility = (state : "visible" | "hidden") => {
        document.visibilityState = state;
        document.dispatch("visibilitychange");
    };

    // PerformanceObserver
    type ObserverCallback = (list : PerformanceEntryList, observer : PerformanceObserverInstance) => void;
    const observers = new Map<FakePerformanceObserver, { type : string; callback : ObserverCallback }>();
    class FakePerformanceObserver implements PerformanceObserverInstance {
        static readonly supportedEntryTypes = ["long-animation-frame", "event", "layout-shift", "paint", "largest-contentful-paint"];
        constructor(private readonly callback : ObserverCallback) {}
        observe({ type } : { type : string }) {
            observers.set(this, { type, callback : this.callback });
        }
        disconnect() {
            observers.delete(this);
        }
    }
    const emitEntries = (type : string, entries : PerformanceEntryLike[]) => {
        for (const [observer, o] of [...observers]) {
            if (o.type === type) o.callback({ getEntries : () => entries }, observer);
        }
    };

    // MessageChannel: delivery is a macrotask
    class FakeMessageChannel {
        readonly port1 : MessagePortLike = { postMessage : () => {}, onmessage : null, close : () => {} };
        readonly port2 : MessagePortLike = {
            postMessage : (data) => {
                const deliver = this.port1.onmessage as ((event : { data : unknown }) => void) | null;
                setTimeout(() => deliver?.({ data }), 0);
            },
            onmessage : null,
            close : () => {},
        };
    }

    // FinalizationRegistry: gc() collects everything registered so far
    let registered : Array<() => void> = [];
    class FakeFinalizationRegistry<T> {
        constructor(private readonly cleanup : (held : T) => void) {}
        register(_target : object, held : T) { registered.push(() => this.cleanup(held)); }
        unregister() {}
    }
    const gc = () => {
        const collected = registered;
        registered = [];
        for (const collect of collected) collect();
    };

    // PressureObserver
    let pressureCallback : ((records : PressureRecord[]) => void) | undefined;
    class FakePressureObserver {
        constructor(callback : (records : PressureRecord[]) => void) { pressureCallback = callback; }
        observe() { return Promise.resolve(); }
        disconnect() { pressureCallback = undefined; }
        takeRecords() { return []; }
    }

    // Worker: the real worker-side handler, with messages delivered as macrotasks
    const workerListeners = new Set<(event : { data : WorkerToMainMessage }) => void>();
    const workerHandler = createWorkerHandler({
        postMessage : (message) => {
            setTimeout(() => { for (const l of [...workerListeners]) l({ data : message }); }, 0);
        },
        setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
        clearTimeoutFn : (id) => clearTimeout(id),
        clock : { now : () => TIME_ORIGIN + Date.now() },
    });
    const worker : WorkerLike = {
        postMessage : (message) => workerHandler.handleMessage(message),
        addEventListener : (_type, listener) => { workerListeners.add(listener); },
        removeEventListener : (_type, listener) => { workerListeners.delete(listener); },
    };

    const meter = createRecordingMeter();
    const logger = { log : vi.fn() };

    const deps : AllMonitorDeps = {
        logger,
        clock : { now : mainNow },
        meter : meter.meter,
        setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
        clearTimeoutFn : (id) => clearTimeout(id),
        setIntervalFn : (fn, ms) => setInterval(fn, ms) as unknown as number,
        clearIntervalFn : (id) => clearInterval(id),
        document,
        window,
        PerformanceObserver : FakePerformanceObserver,
        requestAnimationFrame : (cb) => setTimeout(() => cb(mainNow()), 16) as unknown as number,
        cancelAnimationFrame : (id) => clearTimeout(id),
        requestIdleCallback : (cb) => setTimeout(() => cb({ didTimeout : false, timeRemaining : () => 12 }), 50) as unknown as number,
        cancelIdleCallback : (id) => clearTimeout(id),
        MessageChannel : FakeMessageChannel as unknown as MessageChannelConstructor,
        queueMicrotask : (cb) => queueMicrotask(cb),
        memorySource : { readLegacy : () => ({ usedJSHeapSize : 10, totalJSHeapSize : 20, jsHeapSizeLimit : 100 }) },
        PressureObserver : FakePressureObserver as unknown as PressureObserverInit,
        FinalizationRegistry : FakeFinalizationRegistry as unknown as FinalizationRegistryConstructor,
        worker,
        workerHeartbeatIntervalMs : 250,
        performance : { timeOrigin : TIME_ORIGIN, now : mainNow },
    };

    return {
        deps,
        meter,
        logger,
        document,
        window,
        setVisibility,
        emitEntries,
        gc,
        emitPressure : (records : PressureRecord[]) => pressureCallback?.(records),
        addLag : (ms : number) => { lagMs += ms; },
        observerCount : () => observers.size,
        workerListenerCount : () => workerListeners.size,
        workerRunning : () => workerHandler.running,
    };
}

/**
 * Advance fake time, flushing promise continuations between timers
 * (MacrotaskLag and MemoryMonitor report from async code).
 */
const advance = (ms : number) : Promise<void> => vi.advanceTimersByTimeAsync(ms).then(() => {});

/** Exercise every monitor: timers, observers, pressure and GC. */
async function generateActivity(browser : ReturnType<typeof createFakeBrowser>) : Promise<void> {
    for (let i = 0; i < 20; i++) {
        browser.addLag(i % 3 === 0 ? 40 : 0);
        await advance(500);
    }
    const loafs : LoafEntry[] = [
        { entryType : "long-animation-frame", name : "", startTime : 10, duration : 80, blockingDuration : 30, renderStart : 70, styleAndLayoutStart : 75, scripts : [] },
        { entryType : "long-animation-frame", name : "", startTime : 99, duration : 123, blockingDuration : 73, renderStart : 0, styleAndLayoutStart : 0, scripts : [] },
    ];
    const events : EventTimingEntry[] = [1, 2, 3].map(id => ({
        entryType : "event", name : "pointerdown", startTime : id * 100, duration : 40 + id,
        processingStart : id * 100 + 5, processingEnd : id * 100 + 20, interactionId : id, cancelable : true,
    }));
    const shifts : LayoutShiftEntry[] = [
        { entryType : "layout-shift", name : "", startTime : 50, duration : 0, value : 0.013, hadRecentInput : false, lastInputTime : 0, sources : [] },
    ];
    const lcps : LcpEntry[] = [
        { entryType : "largest-contentful-paint", name : "", startTime : 400, duration : 0, renderTime : 400, loadTime : 390, size : 5000, id : "hero", url : "", element : null },
    ];
    browser.emitEntries("long-animation-frame", loafs);
    browser.emitEntries("event", events);
    browser.emitEntries("layout-shift", shifts);
    browser.emitEntries("paint", [{ entryType : "paint", name : "first-contentful-paint", startTime : 321, duration : 0 }]);
    browser.emitEntries("largest-contentful-paint", lcps);
    browser.emitPressure([{ source : "cpu", state : "serious", time : 1234.5 }]);
    browser.gc();
    await advance(500);
}

describe("setupAllMonitors", () => {
    let browser : ReturnType<typeof createFakeBrowser>;
    let handles : AllMonitorHandles;

    beforeEach(() => {
        vi.useFakeTimers();
        browser = createFakeBrowser();
        handles = setupAllMonitors(browser.deps);
    });

    afterEach(() => {
        handles.stop();
        vi.useRealTimers();
    });

    it("registers every monitor when all capabilities are present", () => {
        expect(handles.registry.size).toBe(17);
        for (const handle of handles.registry.getAll()) {
            expect(handle.monitor, handle.name).toBeDefined();
        }
        expect(browser.logger.log).not.toHaveBeenCalledWith("warn", expect.anything(), expect.anything());
    });

    it("feeds every metric", async () => {
        await generateActivity(browser);

        for (const name of [
            "lag_drift_histogram",
            "lag_macrotask_histogram",
            "lag_loaf_blocking_histogram",
            "lag_loaf_duration_histogram",
            "lag_inp_histogram",
            "lag_inp_input_delay_histogram",
            "lag_inp_processing_histogram",
            "lag_inp_presentation_delay_histogram",
            "lag_cls_shift_histogram",
            "lag_frame_delta_histogram",
            "lag_idle_time_remaining_histogram",
            "lag_idle_gap_histogram",
            "lag_scheduling_microtask_histogram",
            "lag_scheduling_macrotask_histogram",
            "lag_scheduling_message_channel_histogram",
            "lag_memory_used_bytes_histogram",
            "lag_worker_main_block_histogram",
            "lag_worker_self_lag_histogram",
            "lag_pressure_change_histogram",
            "lag_gc_events",
        ]) {
            expect(browser.meter.values(name).length, name).toBeGreaterThan(0);
        }

        const gauges = browser.meter.collect();
        for (const name of [
            "lag_drift_max_gauge",
            "lag_drift_avg_gauge",
            "lag_macrotask_max_gauge",
            "lag_macrotask_avg_gauge",
            "lag_timer_throttled_gauge",
            "lag_inp_worst_gauge",
            "lag_cls_worst_session_gauge",
            "lag_paint_first_contentful_paint_gauge",
            "lag_lcp_gauge",
            "lag_frame_fps_gauge",
            "lag_frame_dropped_rate_gauge",
            "lag_idle_timeout_rate_gauge",
            "lag_memory_usage_percent_gauge",
            "lag_worker_main_block_max_gauge",
            "lag_pressure_state_gauge",
            "lag_gc_recent_rate_gauge",
        ]) {
            expect(gauges.get(name)?.length, name).toBeGreaterThan(0);
        }
    });

    it("uses only low-cardinality attributes (no measured values, timestamps or IDs)", async () => {
        await generateActivity(browser);
        browser.setVisibility("hidden");
        browser.setVisibility("visible");

        const allowedKeys = new Set(["source", "from", "to", "trigger"]);
        for (const [name, records] of browser.meter.records()) {
            const attributeSets = new Set<string>();
            for (const { attributes } of records) {
                for (const [key, value] of Object.entries(attributes ?? {})) {
                    expect(allowedKeys.has(key), `${name}.${key}`).toBe(true);
                    expect(typeof value, `${name}.${key}`).toBe("string");
                }
                attributeSets.add(JSON.stringify(attributes ?? {}));
            }
            expect(attributeSets.size, name).toBeLessThanOrEqual(2);
        }
    });

    // Queueing of heartbeats behind a really blocked main thread is covered
    // by the browser test (worker.test.ts); this checks the wiring and math.
    it("measures main-thread lag through DriftLag and the worker's delivery delay", () => {
        vi.advanceTimersByTime(1_000);
        browser.addLag(250);
        vi.advanceTimersByTime(1_000);

        expect(Math.max(...browser.meter.values("lag_drift_histogram"))).toBe(250);
        // + 1ms: fake timers run setTimeout(0), our fake message delivery, after 1ms (as Node does)
        expect(Math.max(...browser.meter.values("lag_worker_main_block_histogram"))).toBe(251);
    });

    it("max gauges report the worst value since the previous collection", () => {
        vi.advanceTimersByTime(1_000);
        browser.addLag(80);
        vi.advanceTimersByTime(1_000);
        expect(browser.meter.collect().get("lag_drift_max_gauge")).toEqual([{ value : 80, attributes : undefined }]);

        vi.advanceTimersByTime(1_000);
        expect(browser.meter.collect().get("lag_drift_max_gauge")).toEqual([{ value : 0, attributes : undefined }]);

        // Nothing measured since the last collection: nothing observed
        expect(browser.meter.collect().get("lag_drift_max_gauge")).toEqual([]);
    });

    it("stop() releases every timer, listener, observer and gauge callback", async () => {
        await generateActivity(browser);
        handles.stop();
        await advance(100); // let in-flight zero-delay callbacks drain

        expect(vi.getTimerCount()).toBe(0);
        expect(browser.document.listenerCount()).toBe(0);
        expect(browser.window.listenerCount()).toBe(0);
        expect(browser.observerCount()).toBe(0);
        expect(browser.workerListenerCount()).toBe(0);
        expect(browser.workerRunning()).toBe(false);
        expect(browser.meter.gaugeCallbackCount()).toBe(0);

        const recordCount = () => [...browser.meter.records().values()].reduce((n, r) => n + r.length, 0);
        const before = recordCount();
        await generateActivity(browser);
        browser.setVisibility("hidden");
        browser.setVisibility("visible");
        await advance(10_000);
        expect(recordCount()).toBe(before);
    });

    it("pauses timer-driven monitors while the page is hidden", async () => {
        await advance(6_000);
        browser.setVisibility("hidden");
        const paused = [
            "lag_drift_histogram",
            "lag_macrotask_histogram",
            "lag_frame_delta_histogram",
            "lag_idle_time_remaining_histogram",
            "lag_scheduling_macrotask_histogram",
            "lag_worker_main_block_histogram",
        ];
        const counts = () => paused.map(name => browser.meter.values(name).length);
        const whenHidden = counts();

        await advance(60_000);
        expect(counts()).toEqual(whenHidden);

        browser.setVisibility("visible");
        await advance(11_000);
        counts().forEach((count, i) => expect(count, paused[i]).toBeGreaterThan(whenHidden[i]!));
    });

    it("keeps the first sample after the page becomes visible again", () => {
        vi.advanceTimersByTime(1_000);
        browser.setVisibility("hidden");
        vi.advanceTimersByTime(5_000);
        browser.setVisibility("visible");
        const before = browser.meter.values("lag_drift_histogram").length;

        vi.advanceTimersByTime(100);

        expect(browser.meter.values("lag_drift_histogram").length).toBe(before + 1);
    });

    it("discards a sample whose window covered a hidden period the event hadn't reported yet", () => {
        vi.advanceTimersByTime(1_000);
        const before = browser.meter.values("lag_drift_histogram").length;

        // visibilityState flips synchronously; the event arrives as a later task
        browser.document.visibilityState = "hidden";
        vi.advanceTimersByTime(50);
        browser.document.visibilityState = "visible";
        vi.advanceTimersByTime(50);

        expect(browser.meter.values("lag_drift_histogram").length).toBe(before);
    });

    it("counts lifecycle transitions", () => {
        browser.setVisibility("hidden");
        browser.setVisibility("visible");

        const records = browser.meter.records().get("lag_lifecycle_transitions") ?? [];
        expect(records.map(r => r.attributes)).toEqual([
            { from : "active", to : "hidden", trigger : "visibilitychange" },
            { from : "hidden", to : "active", trigger : "visibilitychange" },
        ]);
    });
});

describe("setupAllMonitors degradation", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("runs the core monitors with only the required deps", () => {
        const browser = createFakeBrowser();
        const { logger, clock, meter, setTimeoutFn, clearTimeoutFn, setIntervalFn, clearIntervalFn, document, window } = browser.deps;
        const handles = setupAllMonitors({ logger, clock, meter, setTimeoutFn, clearTimeoutFn, setIntervalFn, clearIntervalFn, document, window });

        expect(handles.registry.getAll().map(h => h.name)).toEqual(["lifecycle", "drift-lag", "macrotask-lag", "throttle-detector"]);
        handles.stop();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("skips the worker monitor, with a warning, when performance is missing", () => {
        const browser = createFakeBrowser();
        const { performance : _omit, ...deps } = browser.deps;
        const handles = setupAllMonitors(deps);

        expect(handles.workerMonitor).toBeUndefined();
        expect(browser.logger.log).toHaveBeenCalledWith("warn", expect.stringContaining("Worker lag monitor skipped"), expect.anything());
        handles.stop();
    });

    it("keeps going when one monitor fails to construct", () => {
        const browser = createFakeBrowser();
        const handles = setupAllMonitors({
            ...browser.deps,
            FinalizationRegistry : class { constructor() { throw new Error("unsupported"); } } as unknown as FinalizationRegistryConstructor,
        });

        expect(handles.gcSignal).toBeUndefined();
        expect(handles.registry.get("gc-signal")).toBeDefined();
        expect(handles.driftLag).toBeDefined();
        expect(browser.logger.log).toHaveBeenCalledWith(
            "warn",
            'Failed to create the "gc-signal" monitor.',
            expect.objectContaining({ monitor : "gc-signal" }),
        );
        handles.stop();
    });
});
