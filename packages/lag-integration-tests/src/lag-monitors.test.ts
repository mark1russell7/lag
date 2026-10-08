import { expect, inject } from "vitest";
import { userEvent } from "vitest/browser";
import { createInstanceId, init } from "@mark1russell7/otel-ts";
import {
    setupAllMonitors,
    createOtelEventSink,
    createOtelLoggerAdapter,
    createTeeLogger,
    type AllMonitorHandles,
} from "@lag/core";
import { createLagWorker, type LagWorker } from "@lag/worker";
import {
    blockMainThread,
    createBrowserDeps,
    createConsoleLogger,
    createTeeMeter,
    queryMimirCount,
    wait,
    waitForMimirCount,
    type TeeMeter,
} from "./harness.js";
import { features } from "./features.js";
import { recordMeasurement } from "./commands.js";

const OTLP_ENDPOINT = "http://localhost:4318";
const SERVICE_NAME = "lag-integration-test";

/** The monitors that setupAllMonitors registers in every browser. */
const ALWAYS = [
    "lifecycle", "page-view-vitals", "measurement-conditions", "drift-lag", "macrotask-lag", "throttle-detector",
    // The observer monitors exist in every browser; without the entry type they only log a warning
    "loaf", "event-timing", "layout-shift",
    "frame-timing", "scheduling-fairness", "worker-lag", "gc-signal", "clock-reliability", "clock-drift",
];

/** The monitors that need an API that only some browsers have. */
const OPTIONAL : ReadonlyArray<[string, boolean]> = [
    ["idle-availability", features.requestIdleCallback.supported],
    ["memory", features.performanceMemory.supported || features.measureUserAgentSpecificMemory.supported],
    ["compute-pressure", features.computePressure.supported],
    ["browser-reports", features.reportingObserver.supported],
    // Shared memory needs cross-origin isolation (the coi project tests it)
    ["shared-liveness", globalThis.crossOriginIsolated === true],
];

describe("Lag Monitor Integration", () => {
    let otel : ReturnType<typeof init>;
    let handles : AllMonitorHandles;
    let tee : TeeMeter;
    let worker : LagWorker;

    beforeAll(() => {
        // The setup of the documentation: one writer identity for each page, and native histograms
        const serviceInstanceId = createInstanceId();
        otel = init({
            serviceName : SERVICE_NAME,
            serviceInstanceId,
            endpoint : OTLP_ENDPOINT,
            metricsExportIntervalMs : 5_000,
            histogramAggregation : "exponential",
            tracing : true,
            logs : true,
            faro : false,
        });

        tee = createTeeMeter(otel.getMeter("lag"));
        worker = createLagWorker();
        // Contentful text, so that the page has a first contentful paint and an LCP
        const text = document.createElement("p");
        text.textContent = "Lag monitor integration test";
        document.body.append(text);
        handles = setupAllMonitors(createBrowserDeps({
            // Console + OTel Logs (Loki). Unsupported entry types only warn; keep the console for errors.
            logger : createTeeLogger(createConsoleLogger(["error"]), createOtelLoggerAdapter(otel.getLogger("lag"))),
            meter : tee.meter,
            events : createOtelEventSink(otel.getLogger("lag-events")),
            worker,
            workerHeartbeatIntervalMs : 100,
            workerHangReport : {
                url : `${OTLP_ENDPOINT}/v1/logs`,
                resource : { "service.name" : SERVICE_NAME, "service.instance.id" : serviceInstanceId },
            },
            pageContext : () => ({ "session.id" : otel.getSessionId() }),
            memoryIntervalMs : 5_000,
        }));
        // The monitors record their pending values before each export
        otel.onBeforeFlush(() => handles.flush());
    });

    afterAll(async () => {
        handles?.stop();
        worker?.terminate();
        await otel?.shutdown();
    });

    it("registers a monitor for each API that the browser has, and no other", () => {
        expect(handles.lifecycleStateMachine?.getState()).toMatch(/^(active|passive)$/);
        for (const name of ALWAYS) {
            expect(handles.registry.get(name)?.monitor, name).toBeDefined();
        }
        for (const [name, supported] of OPTIONAL) {
            expect(handles.registry.get(name)?.monitor !== undefined, `${name} (supported: ${supported})`).toBe(supported);
        }
    });

    it("DriftLag measures a blocked main thread", async () => {
        await wait(300);
        const before = tee.values("lag_drift_histogram").length;
        blockMainThread(300);
        await wait(300);

        const max = tee.max("lag_drift_histogram");
        console.log(`DriftLag max after a 300ms block: ${max.toFixed(1)}ms`);
        await recordMeasurement("integration/block-300ms/lag_drift_histogram", "ms", tee.values("lag_drift_histogram").slice(before), { scenario : "block-300ms" });
        expect(max).toBeGreaterThan(200);
    });

    it("the worker measures main-thread blocking from outside the main thread", async () => {
        await wait(500);
        const before = tee.values("lag_worker_main_block_histogram").length;
        expect(before).toBeGreaterThan(0);

        blockMainThread(500);
        await wait(300);

        const after = tee.values("lag_worker_main_block_histogram").slice(before);
        const max = Math.max(...after);
        console.log(`Worker heartbeat max wait after a 500ms block: ${max.toFixed(1)}ms (${after.length} heartbeats)`);
        await recordMeasurement("integration/block-500ms/lag_worker_main_block_histogram", "ms", after, { scenario : "block-500ms" });
        // Heartbeats sent early in the block wait for most of it
        expect(max).toBeGreaterThan(300);
        // A free worker keeps its own timer on schedule
        expect(tee.max("lag_worker_self_lag_histogram")).toBeLessThan(100);
    });

    it("FrameTimingMonitor records frames", async () => {
        await wait(500);
        expect(tee.values("lag_frame_delta_histogram").length).toBeGreaterThan(5);
    });

    it("LongAnimationFrameMonitor records every long frame the browser reports", async (ctx) => {
        ctx.skip(!features.loaf.supported, features.loaf.reason);
        // Headless Chromium in Vitest's iframe doesn't reliably emit LoAF
        // entries for a given frame, so compare against a raw observer
        const raw : number[] = [];
        const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) raw.push((entry as PerformanceEntry & { blockingDuration : number }).blockingDuration);
        });
        observer.observe({ type : "long-animation-frame", buffered : true });

        await new Promise<void>(resolve => requestAnimationFrame(() => {
            blockMainThread(150);
            resolve();
        }));
        await wait(500);
        observer.disconnect();

        const blocking = tee.values("lag_loaf_blocking_histogram");
        console.log(`LoAF blocking durations — browser: [${raw.join(", ")}], monitor: [${blocking.join(", ")}]`);
        expect(blocking).toEqual(raw);
    });

    it("PageViewVitals measures the load of the page and a real click", async (ctx) => {
        ctx.skip(!features.eventTiming.supported, features.eventTiming.reason);
        const button = document.createElement("button");
        button.id = "slow-button";
        button.textContent = "Slow";
        button.addEventListener("click", () => blockMainThread(120));
        document.body.append(button);

        await userEvent.click(button);
        await wait(500);

        const vitals = Object.fromEntries(handles.vitals!.getValues().map(v => [v.name, v]));
        console.log(`Vitals of the test page: ${JSON.stringify(Object.fromEntries(Object.entries(vitals).map(([k, v]) => [k, v.value])))}`);
        // A browser can hold back the paints of a window that it does not show, for example Safari on
        // a CI runner (an INP of 904 ms for this 120 ms handler one time). Then the phases say nothing about the click.
        ctx.skip((vitals["INP"]?.value ?? 0) > 400,
            `The browser held back the next paint: the INP is ${vitals["INP"]?.value} ms for a handler of 120 ms (visibilityState "${document.visibilityState}").`);
        expect(handles.vitals!.getView().navigationType).toMatch(/^(navigate|reload)$/);
        expect(vitals["TTFB"]!.value).toBeGreaterThanOrEqual(0);
        expect(vitals["FCP"]!.value).toBeGreaterThan(0);
        expect(vitals["LCP"]!.value).toBeGreaterThanOrEqual(vitals["FCP"]!.value);
        expect(vitals["INP"]!.value).toBeGreaterThanOrEqual(120);
        expect(vitals["INP"]!.attribution).toMatchObject({ interaction_target : "#slow-button", interaction_type : "pointer" });
        expect(Number(vitals["INP"]!.attribution["processing_duration_ms"])).toBeGreaterThanOrEqual(110);
        // The Event Timing monitor sees the same interaction
        expect(tee.max("lag_event_duration_histogram")).toBeGreaterThanOrEqual(120);
    });

    it("MacrotaskLag, SchedulingFairness and idle monitors sample within one 5s cycle", async () => {
        await wait(5_500);

        expect(tee.values("lag_macrotask_histogram").length).toBeGreaterThan(0);
        expect(tee.values("lag_scheduling_message_channel_histogram").length).toBeGreaterThan(0);
        if (features.requestIdleCallback.supported) {
            expect(tee.values("lag_idle_time_remaining_histogram").length).toBeGreaterThan(0);
        } else {
            expect(handles.idleMonitor).toBeUndefined();
        }
    });

    it("MemoryMonitor samples the heap through performance.memory", (ctx) => {
        ctx.skip(!features.performanceMemory.supported, features.performanceMemory.reason);
        expect(tee.max("lag_memory_used_bytes_histogram")).toBeGreaterThan(0);
        expect(tee.records("lag_memory_used_bytes_histogram")[0]?.attributes).toEqual({ source : "legacy" });
    });

    it("ClockReliabilityChecker reports the clock resolution", () => {
        const resolution = handles.clockChecker!.getResolutionMs();
        console.log(`performance.now() resolution: ${resolution}ms, high-res: ${handles.clockChecker!.isHighResolution()}`);
        expect(resolution).toBeGreaterThan(0);
        expect(resolution).toBeLessThanOrEqual(1);
        expect(handles.clockChecker!.isHighResolution()).toBe(globalThis.crossOriginIsolated);
    });

    it("GCSignalDetector counts GC cycles under allocation pressure", async () => {
        const before = handles.gcSignal!.getTotalGCEvents();

        for (let i = 0; i < 20; i++) {
            const garbage : unknown[] = [];
            for (let j = 0; j < 10_000; j++) {
                garbage.push({ a : Math.random(), b : new Array(20).fill(0) });
            }
            await wait(50);
        }

        const after = handles.gcSignal!.getTotalGCEvents();
        console.log(`GCSignalDetector: before=${before} after=${after} delta=${after - before}`);
        // The engine decides when to GC, so the count itself is informational
        expect(after).toBeGreaterThanOrEqual(before);
        expect(tee.values("lag_gc_events").length).toBe(after);
    });

    it("emits a synthetic log to verify the Loki bridge", () => {
        otel.getLogger("lag-integration-test").emit({
            severityText : "info",
            severityNumber : 9,
            body : "Integration test log: lag monitor stack initialized",
            attributes : {
                "test.suite" : "lag-integration-tests",
                "test.event" : "stack-initialized",
            },
        });
    });

    it("stop() halts all reporting", async () => {
        handles.stop();
        await wait(50); // in-flight callbacks drain
        const before = tee.totalRecords();

        blockMainThread(200);
        await wait(1_500);

        expect(tee.totalRecords()).toBe(before);
    });

    it("flushes metrics to the OTLP endpoint", async () => {
        await otel.shutdown();
        // Alloy batches for up to 1 s before it forwards to Mimir. Without the stack, one query returns 0 at once.
        const driftCount = inject("e2e")
            ? await waitForMimirCount("lag_drift_histogram", SERVICE_NAME, 45_000)
            : await queryMimirCount("lag_drift_histogram", SERVICE_NAME);
        console.log(`Mimir: lag_drift_histogram_count=${driftCount}`);
        // Required in the e2e project (pnpm test:e2e starts the Grafana stack); optional elsewhere
        if (inject("e2e")) {
            expect(driftCount).toBeGreaterThan(0);
        }
    }, 90_000);
});
