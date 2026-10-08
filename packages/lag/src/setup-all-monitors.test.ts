import { vi, expect } from "vitest";
import { setupAllMonitors, type AllMonitorDeps, type AllMonitorHandles } from "./setup-all-monitors.js";
import { createWorkerHandler, type HangEvent } from "./lag-worker.js";
import { createRecordingMeter, expectCatalogEvents, expectCatalogInstruments } from "./test-utils.js";
import { METRIC_CATALOG, METRICS } from "./metric-catalog.js";
import type {
    EventTimingEntry,
    LayoutShiftEntry,
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
import type { ReportingObserverInit, ReportLike } from "./BrowserReportMonitor.js";

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
 * vitest's fake timers. `addLag` shifts the main-thread clock forward to
 * simulate the main thread falling behind. Both threads read `Date.now()`, so
 * `vi.setSystemTime` moves both clocks, as a system suspend on Windows does.
 */
function createFakeBrowser() {
    const TIME_ORIGIN = 1_700_000_000_000;
    let lagMs = 0;
    let wallShiftMs = 0;
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
        static readonly supportedEntryTypes = ["long-animation-frame", "event", "first-input", "layout-shift", "paint", "largest-contentful-paint"];
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

    // ReportingObserver
    let reportingCallback : ((reports : ReportLike[]) => void) | undefined;
    class FakeReportingObserver {
        constructor(callback : (reports : ReportLike[]) => void) { reportingCallback = callback; }
        observe() {}
        disconnect() { reportingCallback = undefined; }
    }

    // Worker: the real worker-side handler. Messages to the main thread are
    // macrotasks; while `mainBlocked`, they queue as they would behind a
    // blocked main thread.
    const workerListeners = new Set<(event : { data : WorkerToMainMessage }) => void>();
    let mainBlocked = false;
    let queuedForMain : WorkerToMainMessage[] = [];
    const deliverToMain = (message : WorkerToMainMessage) => {
        for (const l of [...workerListeners]) l({ data : message });
    };
    const reportHang = vi.fn<(event : HangEvent) => void>();
    const workerHandler = createWorkerHandler({
        postMessage : (message) => {
            if (mainBlocked) queuedForMain.push(message);
            else setTimeout(() => deliverToMain(message), 0);
        },
        setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
        clearTimeoutFn : (id) => clearTimeout(id),
        clock : { now : () => TIME_ORIGIN + Date.now() },
        reportHang,
    });
    const worker : WorkerLike = {
        postMessage : (message) => workerHandler.handleMessage(message),
        addEventListener : (_type, listener) => { workerListeners.add(listener); },
        removeEventListener : (_type, listener) => { workerListeners.delete(listener); },
    };

    const meter = createRecordingMeter();
    const logger = { log : vi.fn() };
    const events = { emit : vi.fn() };

    const deps : AllMonitorDeps = {
        logger,
        events,
        clock : { now : mainNow },
        wallClock : { now : () => TIME_ORIGIN + mainNow() + wallShiftMs },
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
        ReportingObserver : FakeReportingObserver as unknown as ReportingObserverInit,
        worker,
        workerHeartbeatIntervalMs : 250,
        performance : { timeOrigin : TIME_ORIGIN, now : mainNow },
        page : {
            navigation : () => ({ type : "navigate", activationStart : 0, responseStart : 120, url : "https://shop.example/cart?id=7" }),
            isPrerendering : () => false,
            wasDiscarded : () => false,
            hiddenTimes : () => [],
            onActivation : () => () => {},
        },
    };

    return {
        deps,
        meter,
        logger,
        events,
        document,
        window,
        reportHang,
        setVisibility,
        emitEntries,
        gc,
        emitPressure : (records : PressureRecord[]) => pressureCallback?.(records),
        emitReports : (reports : ReportLike[]) => reportingCallback?.(reports),
        addLag : (ms : number) => { lagMs += ms; },
        /** Step the wall clock only, as an NTP step or a manual clock change does. */
        shiftWallClock : (ms : number) => { wallShiftMs += ms; },
        blockMain : () => { mainBlocked = true; },
        unblockMain : () => {
            mainBlocked = false;
            const queued = queuedForMain;
            queuedForMain = [];
            for (const message of queued) deliverToMain(message);
        },
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

/** Exercise every monitor: timers, observers, pressure, reports and GC. */
async function generateActivity(browser : ReturnType<typeof createFakeBrowser>) : Promise<void> {
    for (let i = 0; i < 24; i++) {
        browser.addLag(i % 3 === 0 ? 40 : 0);
        await advance(500);
    }
    const loafs : LoafEntry[] = [
        { entryType : "long-animation-frame", name : "", startTime : 10, duration : 80, blockingDuration : 30, renderStart : 70, styleAndLayoutStart : 75, scripts : [] },
        { entryType : "long-animation-frame", name : "", startTime : 99, duration : 223, blockingDuration : 173, renderStart : 0, styleAndLayoutStart : 0, scripts : [
            { name : "script", invoker : "BUTTON#buy.onclick", invokerType : "event-listener", startTime : 99, executionStart : 100, duration : 200, forcedStyleAndLayoutDuration : 0, sourceURL : "https://shop.example/app.js?v=123" },
        ] },
    ];
    const events : EventTimingEntry[] = [1, 2, 3].map(id => ({
        entryType : "event", name : id === 3 ? "keydown" : "pointerdown", startTime : id * 100, duration : 40 + id,
        processingStart : id * 100 + 5, processingEnd : id * 100 + 20, interactionId : id, cancelable : true,
    }));
    const shifts : LayoutShiftEntry[] = [
        { entryType : "layout-shift", name : "", startTime : 50, duration : 0, value : 0.013, hadRecentInput : false, lastInputTime : 0, sources : [] },
    ];
    browser.emitEntries("paint", [{ entryType : "paint", name : "first-contentful-paint", startTime : 40, duration : 0 }]);
    browser.emitEntries("largest-contentful-paint", [{ entryType : "largest-contentful-paint", name : "", startTime : 60, duration : 0 }]);
    browser.emitEntries("long-animation-frame", loafs);
    browser.emitEntries("event", events);
    browser.emitEntries("layout-shift", shifts);
    browser.emitPressure([{ source : "cpu", state : "serious", time : 1234.5 }]);
    browser.emitReports([{ type : "intervention", url : "https://shop.example/", body : { id : "HeavyAdIntervention", message : "Ad removed", sourceFile : "https://ads.example/ad.js?id=9", lineNumber : 3 } }]);
    browser.gc();
    await advance(500);
}

/** The metrics that need a special situation. Other tests examine them. */
const NOT_IN_NORMAL_ACTIVITY = new Set([
    METRICS.samplesDiscarded.name,
    METRICS.stalls.name,
    METRICS.stallDuration.name,
    METRICS.hangs.name,
    METRICS.hangDuration.name,
    METRICS.clockJumps.name,
    METRICS.lifecycleTransitions.name,
    // Fake time does not advance in the checker's tight loop; ClockReliabilityChecker tests cover it
    METRICS.clockResolution.name,
    METRICS.livenessBlock.name,
]);

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
        expect(handles.registry.getAll().map(h => h.name)).toEqual([
            "lifecycle", "page-view-vitals", "measurement-conditions", "drift-lag", "macrotask-lag", "throttle-detector",
            "loaf", "event-timing", "layout-shift", "frame-timing", "idle-availability", "scheduling-fairness",
            "memory", "worker-lag", "compute-pressure", "gc-signal", "clock-reliability", "clock-drift", "browser-reports",
            "page-view-context",
        ]);
        for (const handle of handles.registry.getAll()) {
            expect(handle.monitor, handle.name).toBeDefined();
        }
        expect(browser.logger.log).not.toHaveBeenCalledWith("warn", expect.anything(), expect.anything());
    });

    it("feeds every metric of the catalog that normal activity produces", async () => {
        await generateActivity(browser);
        await advance(10_000);
        // The vitals report when the page becomes hidden
        browser.setVisibility("hidden");
        browser.setVisibility("visible");

        for (const definition of METRIC_CATALOG) {
            if (NOT_IN_NORMAL_ACTIVITY.has(definition.name)) continue;
            expect(browser.meter.values(definition.name).length, definition.name).toBeGreaterThan(0);
        }
    });

    it("creates only catalog instruments, with the catalog kind, unit and attribute values", async () => {
        await generateActivity(browser);
        browser.setVisibility("hidden");
        browser.setVisibility("visible");

        const byName = new Map(METRIC_CATALOG.map(m => [m.name, m]));
        for (const instrument of browser.meter.instruments()) {
            const definition = byName.get(instrument.name);
            expect(definition, instrument.name).toBeDefined();
            expect(instrument.kind, instrument.name).toBe(definition!.kind);
            expect(instrument.unit, instrument.name).toBe(definition!.unit);
            for (const { attributes } of instrument.values) {
                for (const [key, value] of Object.entries(attributes ?? {})) {
                    expect(definition!.attributes[key], `${instrument.name}.${key}`).toBeDefined();
                    expect(definition!.attributes[key], `${instrument.name}.${key}=${String(value)}`).toContain(value);
                }
            }
        }
    });

    it("emits attribution events without query strings", async () => {
        await generateActivity(browser);

        expect(browser.events.emit).toHaveBeenCalledWith("lag.long_animation_frame", expect.objectContaining({
            blocking_duration_ms : 173,
            "script.invoker" : "BUTTON#buy.onclick",
            "script.source_url" : "https://shop.example/app.js",
        }));
        expect(browser.events.emit).toHaveBeenCalledWith("lag.browser_report", expect.objectContaining({
            id : "HeavyAdIntervention",
            source_file : "https://ads.example/ad.js",
        }));
    });

    it("gives the ID of the current page view to the worker, for its hang reports", () => {
        expect(handles.pageViewContext!.getAttributes()).toEqual({ "lag.page_view.id" : handles.vitals!.getView().id });
    });

    // This test shows a bug in the catalog. setupAllMonitors gives the attribute lag.page_view.id to each event.
    // But the catalog does not list it for lag.long_animation_frame, lag.browser_report, lag.stall and
    // lag.clock.jump. Thus the documentation of these events does not show it.
    it("sends only the event attributes that the catalog lists", async () => {
        await generateActivity(browser);

        expectCatalogEvents(browser.events.emit);
    });

    it("gives the ID of the current page view to the events of the other monitors", async () => {
        await generateActivity(browser);

        expect(browser.events.emit).toHaveBeenCalledWith("lag.long_animation_frame", expect.objectContaining({
            "lag.page_view.id" : handles.vitals!.getView().id,
        }));
    });

    it("flush() records the pending Web Vitals, for the before-flush hook of an exporter", async () => {
        await generateActivity(browser);
        expect(browser.meter.values("lag_web_vital_fcp_histogram")).toEqual([]);

        handles.flush();
        expect(browser.meter.values("lag_web_vital_fcp_histogram")).toEqual([40]);
    });

    it("records each Web Vital once for each page view, and sends events with the semantic-convention names", async () => {
        await generateActivity(browser);
        browser.setVisibility("hidden");
        browser.setVisibility("visible");
        browser.setVisibility("hidden");

        expect(browser.meter.values("lag_web_vital_ttfb_histogram")).toEqual([120]);
        expect(browser.meter.values("lag_web_vital_fcp_histogram")).toEqual([40]);
        expect(browser.meter.values("lag_web_vital_lcp_histogram")).toEqual([60]);
        expect(browser.meter.values("lag_web_vital_inp_histogram")).toEqual([43]);
        expect(browser.meter.values("lag_web_vital_cls_histogram")).toEqual([0.013]);
        expect(browser.meter.records().get("lag_web_vital_inp_histogram")![0]!.attributes).toEqual({ navigation_type : "navigate" });

        const view = handles.vitals!.getView();
        expect(browser.events.emit).toHaveBeenCalledWith("browser.web_vital", expect.objectContaining({
            "browser.web_vital.name" : "inp",
            "browser.web_vital.value" : 43,
            "browser.web_vital.delta" : 43,
            "browser.web_vital.id" : `${view.id}-inp`,
            "browser.web_vital.rating" : "good",
            "browser.web_vital.navigation_type" : "navigate",
            "lag.page_view.id" : view.id,
            "lag.page_view.url" : "https://shop.example/cart",
            "lag.web_vital.interaction_type" : "keyboard",
        }));
        // An unchanged value sends no second event
        const inpEvents = browser.events.emit.mock.calls.filter(([name, a]) =>
            name === "browser.web_vital" && (a as Record<string, unknown>)["browser.web_vital.name"] === "inp");
        expect(inpEvents).toHaveLength(1);
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

    it("synchronizes the worker clock and records the offset", () => {
        vi.advanceTimersByTime(100);
        expect(browser.meter.values("lag_worker_clock_offset_histogram").length).toBe(1);
        expect(handles.workerMonitor!.getClockSync()?.offsetMs).toBeCloseTo(0, 0);
    });

    it("discards a lag sample that overlaps a system suspend, after the worker reports it", async () => {
        await advance(1_000);
        const before = browser.meter.values("lag_drift_histogram").length;

        // The system sleeps for 60 s: both clocks jump, and every timer fires late
        vi.setSystemTime(Date.now() + 60_000);
        await advance(5_000);

        expect(browser.meter.values("lag_drift_histogram").filter(v => v > 1_000)).toEqual([]);
        expect(browser.meter.values("lag_drift_histogram").length).toBeGreaterThan(before);
        // The stall samples of all monitors are one episode
        expect(browser.meter.records().get("lag_stalls")).toEqual([{ value : 1, attributes : { kind : "suspend" } }]);
        expect(browser.reportHang).not.toHaveBeenCalled();
        expectCatalogInstruments(browser.meter);
        expectCatalogEvents(browser.events.emit, ["lag.page_view.id"]);
    });

    it("detects a main-thread hang in the worker, and records it when the main thread runs again", async () => {
        await advance(1_000);

        browser.blockMain();
        await advance(8_000);
        expect(browser.reportHang).toHaveBeenCalledWith(expect.objectContaining({ phase : "started" }), expect.anything());

        browser.unblockMain();
        await advance(5_000);

        expect(browser.reportHang).toHaveBeenCalledWith(expect.objectContaining({ phase : "ended" }), expect.anything());
        // The stall samples of all monitors are one episode
        expect(browser.meter.sum("lag_stalls")).toBe(1);
        expect(browser.meter.sum("lag_main_thread_hangs")).toBe(1);
        expect(Math.max(...browser.meter.values("lag_main_thread_hang_duration_histogram"))).toBeGreaterThanOrEqual(5_000);
        expect(Math.max(...browser.meter.values("lag_worker_main_block_histogram"))).toBeGreaterThanOrEqual(7_000);
        expect(browser.events.emit).toHaveBeenCalledWith("lag.main_thread.hang", expect.objectContaining({ phase : "ended" }));
        expect(browser.events.emit).toHaveBeenCalledWith("lag.stall", expect.objectContaining({ kind : "hang" }));
        expectCatalogInstruments(browser.meter);
        expectCatalogEvents(browser.events.emit, ["lag.page_view.id"]);
    });

    it("counts samples that it discards because the page was hidden", async () => {
        await advance(1_000);
        // visibilityState flips first; the event comes later
        browser.document.visibilityState = "hidden";
        await advance(200);

        expect(browser.meter.records().get("lag_samples_discarded")?.some(r => r.attributes?.["reason"] === "hidden")).toBe(true);
        expectCatalogInstruments(browser.meter);
    });

    it("records clock jumps", async () => {
        await advance(10_000);
        browser.shiftWallClock(-5_000);
        await advance(10_000);

        expect(browser.meter.records().get("lag_clock_jumps")?.map(r => r.attributes)).toEqual([{ direction : "backward", kind : "step" }]);
        expect(browser.events.emit).toHaveBeenCalledWith("lag.clock.jump", expect.objectContaining({ direction : "backward", kind : "step" }));
    });

    it("stop() releases every timer, listener, observer and worker loop", async () => {
        await generateActivity(browser);
        handles.stop();
        await advance(100); // let in-flight zero-delay callbacks drain

        expect(vi.getTimerCount()).toBe(0);
        expect(browser.document.listenerCount()).toBe(0);
        expect(browser.window.listenerCount()).toBe(0);
        expect(browser.observerCount()).toBe(0);
        expect(browser.workerListenerCount()).toBe(0);
        expect(browser.workerRunning()).toBe(false);

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

    it("gives each monitor of the registry through its typed getter", () => {
        const getters : Array<[keyof AllMonitorHandles, string]> = [
            ["conditions", "measurement-conditions"],
            ["vitals", "page-view-vitals"],
            ["driftLag", "drift-lag"],
            ["macrotaskLag", "macrotask-lag"],
            ["lifecycleStateMachine", "lifecycle"],
            ["loafMonitor", "loaf"],
            ["eventTimingMonitor", "event-timing"],
            ["layoutShiftMonitor", "layout-shift"],
            ["frameMonitor", "frame-timing"],
            ["idleMonitor", "idle-availability"],
            ["schedulingMonitor", "scheduling-fairness"],
            ["memoryMonitor", "memory"],
            ["workerMonitor", "worker-lag"],
            ["pressureMonitor", "compute-pressure"],
            ["gcSignal", "gc-signal"],
            ["throttleDetector", "throttle-detector"],
            ["clockChecker", "clock-reliability"],
            ["clockDrift", "clock-drift"],
            ["browserReports", "browser-reports"],
            ["pageViewContext", "page-view-context"],
        ];

        for (const [getter, name] of getters) {
            expect(handles[getter], getter).toBeDefined();
            expect(handles[getter], getter).toBe(handles.registry.get(name)!.monitor);
        }
    });

    it("gives the ID of the current page view to the hang reports of the worker", async () => {
        await advance(1_000);

        browser.blockMain();
        await advance(8_000);

        expect(browser.reportHang).toHaveBeenCalledWith(
            expect.objectContaining({ phase : "started", attributes : { "lag.page_view.id" : handles.vitals!.getView().id } }),
            expect.anything(),
        );
        browser.unblockMain();
    });

    it("stop() reports the stall episode that waits, with its kind", async () => {
        await advance(1_000);
        // The main thread falls 6 s behind. Each timer-driven monitor gets a stall sample.
        browser.addLag(6_000);
        await advance(3_000);
        expect(browser.meter.sum("lag_stalls")).toBe(0);

        handles.stop();

        expect(browser.meter.records().get("lag_stalls")).toEqual([{ value : 1, attributes : { kind : "hang" } }]);
        expect(browser.meter.records().get("lag_stall_duration_histogram")).toEqual([{ value : expect.any(Number), attributes : { kind : "hang" } }]);
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

describe("setupAllMonitors with shared memory", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("adds the shared-memory liveness monitor, and DriftLag beats the counter", async () => {
        const browser = createFakeBrowser();
        const buffers : SharedArrayBuffer[] = [];
        class RecordingSharedArrayBuffer extends SharedArrayBuffer {
            constructor(bytes : number) {
                super(bytes);
                buffers.push(this);
            }
        }
        const handles = setupAllMonitors({ ...browser.deps, SharedArrayBuffer : RecordingSharedArrayBuffer });

        expect(handles.sharedLiveness).toBeDefined();
        expect(handles.registry.getAll().map(h => h.name)).toContain("shared-liveness");
        await advance(1_000);
        expect(Atomics.load(new Int32Array(buffers[0]!), 0)).toBeGreaterThan(100);

        handles.stop();
        await advance(100);
        expect(vi.getTimerCount()).toBe(0);
    });
});

describe("setupAllMonitors degradation", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("runs the core monitors with only the required deps", () => {
        const browser = createFakeBrowser();
        const { logger, clock, meter, setTimeoutFn, clearTimeoutFn, setIntervalFn, clearIntervalFn, document, window } = browser.deps;
        const handles = setupAllMonitors({ logger, clock, meter, setTimeoutFn, clearTimeoutFn, setIntervalFn, clearIntervalFn, document, window });

        expect(handles.registry.getAll().map(h => h.name)).toEqual([
            "lifecycle", "measurement-conditions", "drift-lag", "macrotask-lag", "throttle-detector",
        ]);
        handles.stop();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("skips the worker monitor, with a warning, when performance is missing", () => {
        const browser = createFakeBrowser();
        const { performance : _omit, ...deps } = browser.deps;
        const handles = setupAllMonitors(deps);

        expect(handles.workerMonitor).toBeUndefined();
        expect(browser.logger.log).toHaveBeenCalledWith("warn", expect.stringContaining("Worker lag monitor skipped"), { type : "setupAllMonitors" });
        handles.stop();
    });

    it("keeps the timer-driven monitors when the page lifecycle cannot start", () => {
        const browser = createFakeBrowser();
        const document = { ...browser.deps.document, addEventListener : () => { throw new Error("no events"); } };
        const handles = setupAllMonitors({ ...browser.deps, document });

        expect(handles.lifecycleStateMachine).toBeUndefined();
        expect(handles.vitals).toBeUndefined();
        expect(handles.driftLag).toBeDefined();
        expect(handles.conditions).toBeDefined();
        expect(browser.logger.log).toHaveBeenCalledWith("warn", 'Failed to create the "lifecycle" monitor.', expect.objectContaining({ monitor : "lifecycle" }));
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

    it("registers no monitor whose dependencies are not complete, and logs no warning", () => {
        const browser = createFakeBrowser();
        const { cancelAnimationFrame : _frame, cancelIdleCallback : _idle, queueMicrotask : _microtask, worker : _worker, wallClock : _wall, ...deps } = browser.deps;
        const handles = setupAllMonitors(deps);
        const names = handles.registry.getAll().map(h => h.name);

        for (const name of ["frame-timing", "idle-availability", "scheduling-fairness", "worker-lag", "clock-drift", "page-view-context"]) {
            expect(names, name).not.toContain(name);
        }
        expect(browser.logger.log).not.toHaveBeenCalledWith("warn", expect.anything(), expect.anything());
        handles.stop();
    });

    it("registers no page-view context without the page-view vitals", () => {
        const browser = createFakeBrowser();
        const { PerformanceObserver : _observer, ...deps } = browser.deps;
        const handles = setupAllMonitors(deps);

        expect(handles.registry.getAll().map(h => h.name)).not.toContain("page-view-context");
        expect(() => handles.flush()).not.toThrow();
        expect(browser.logger.log).not.toHaveBeenCalledWith("warn", expect.anything(), expect.anything());
        handles.stop();
    });

    it("gives the page-view ID to the crash-report context of the browser, also without a worker", async () => {
        const browser = createFakeBrowser();
        const { worker : _worker, ...deps } = browser.deps;
        const crashReport = { set : vi.fn() };
        const handles = setupAllMonitors({ ...deps, crashReport });
        await advance(0);

        expect(handles.pageViewContext).toBeDefined();
        expect(crashReport.set).toHaveBeenCalledWith("lag.page_view.id", handles.vitals!.getView().id);
        handles.stop();
    });

    it("counts a stall without an event sink", async () => {
        const browser = createFakeBrowser();
        const { events : _events, ...deps } = browser.deps;
        const handles = setupAllMonitors(deps);
        await advance(1_000);

        browser.addLag(6_000);
        await advance(5_000);

        expect(browser.meter.sum("lag_stalls")).toBe(1);
        handles.stop();
    });

    it("sends the stall events without a page-view ID when the page-view vitals are missing", async () => {
        const browser = createFakeBrowser();
        const { PerformanceObserver : _observer, ...deps } = browser.deps;
        const handles = setupAllMonitors(deps);
        await advance(1_000);

        browser.addLag(6_000);
        await advance(5_000);

        expect(browser.events.emit).toHaveBeenCalledWith("lag.stall", { kind : "hang", duration_ms : expect.any(Number) });
        handles.stop();
    });
});
