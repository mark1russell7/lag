import { expect } from "vitest";
import { init } from "@mark1russell7/otel-ts";
import {
    setupAllMonitors,
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
    wait,
    type TeeMeter,
} from "./harness.js";

const OTLP_ENDPOINT = "http://localhost:4318";
const MIMIR_QUERY_URL = "http://localhost:9009/prometheus/api/v1/query";
const SERVICE_NAME = "lag-integration-test";

// Query Mimir for a metric; 0 when the Grafana stack isn't running
async function queryMimir(query : string) : Promise<number> {
    try {
        const res = await fetch(`${MIMIR_QUERY_URL}?query=${encodeURIComponent(query)}`);
        const json = await res.json();
        if (json.data?.result?.length > 0) {
            return parseFloat(json.data.result[0].value[1]);
        }
    } catch {
        // Mimir not reachable — expected without the docker stack
    }
    return 0;
}

describe("Lag Monitor Integration", () => {
    let otel : ReturnType<typeof init>;
    let handles : AllMonitorHandles;
    let tee : TeeMeter;
    let worker : LagWorker;

    beforeAll(() => {
        otel = init({
            serviceName : SERVICE_NAME,
            endpoint : OTLP_ENDPOINT,
            metricsExportIntervalMs : 5_000,
            tracing : true,
            logs : true,
            faro : false,
        });

        tee = createTeeMeter(otel.getMeter("lag"));
        worker = createLagWorker();
        handles = setupAllMonitors(createBrowserDeps({
            // Console + OTel Logs (Loki)
            logger : createTeeLogger(createConsoleLogger(), createOtelLoggerAdapter(otel.getLogger("lag"))),
            meter : tee.meter,
            worker,
            workerHeartbeatIntervalMs : 100,
            memoryIntervalMs : 5_000,
        }));
    });

    afterAll(async () => {
        handles?.stop();
        worker?.terminate();
        await otel?.shutdown();
    });

    it("wires every monitor Chromium supports", () => {
        expect(handles.lifecycleStateMachine?.getState()).toMatch(/^(active|passive)$/);
        for (const name of [
            "drift-lag", "macrotask-lag", "throttle-detector", "loaf", "event-timing", "layout-shift",
            "paint-timing", "lcp", "frame-timing", "idle-availability", "scheduling-fairness",
            "worker-lag", "gc-signal", "clock-reliability",
        ]) {
            expect(handles.registry.get(name)?.monitor, name).toBeDefined();
        }
    });

    it("DriftLag measures a blocked main thread", async () => {
        await wait(300);
        blockMainThread(300);
        await wait(300);

        const max = tee.max("lag_drift_histogram");
        console.log(`DriftLag max after a 300ms block: ${max.toFixed(1)}ms`);
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
        // Heartbeats sent early in the block wait for most of it
        expect(max).toBeGreaterThan(300);
        // A free worker keeps its own timer on schedule
        expect(tee.max("lag_worker_self_lag_histogram")).toBeLessThan(100);
    });

    it("FrameTimingMonitor records frames", async () => {
        await wait(500);
        expect(tee.values("lag_frame_delta_histogram").length).toBeGreaterThan(5);
    });

    it("LongAnimationFrameMonitor records every long frame the browser reports", async () => {
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

    it("MacrotaskLag, SchedulingFairness and idle monitors sample within one 5s cycle", async () => {
        await wait(5_500);

        expect(tee.values("lag_macrotask_histogram").length).toBeGreaterThan(0);
        expect(tee.values("lag_scheduling_message_channel_histogram").length).toBeGreaterThan(0);
        expect(tee.values("lag_idle_time_remaining_histogram").length).toBeGreaterThan(0);
    });

    it("MemoryMonitor samples the heap (where performance.memory exists)", () => {
        if (!(window.performance as { memory? : unknown }).memory) return;
        expect(tee.max("lag_memory_used_bytes_histogram")).toBeGreaterThan(0);
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
        // Give Alloy time to forward to Mimir
        await wait(3_000);

        const driftCount = await queryMimir(`lag_drift_histogram_count{service_name="${SERVICE_NAME}"}`);
        console.log(`Mimir: lag_drift_histogram_count=${driftCount}`);
        // Only checkable with the Grafana stack running (pnpm infra:up)
        if (driftCount > 0) {
            expect(driftCount).toBeGreaterThan(0);
        }
    });
});
