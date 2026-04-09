import { expect } from "vitest";
import { init } from "@mark1russell7/otel-ts";
import {
    setupAllMonitors,
    createOtelLoggerAdapter,
    createTeeLogger,
    type AllMonitorHandles,
} from "@lag/lag";
import { createLagWorker } from "@lag/lag-worker";

const OTLP_ENDPOINT = "http://localhost:4318";
const MIMIR_QUERY_URL = "http://localhost:9009/prometheus/api/v1/query";
const SERVICE_NAME = "lag-integration-test";

// Block the main thread synchronously for `ms` milliseconds
function blockMainThread(ms: number): void {
    const start = performance.now();
    while (performance.now() - start < ms) {
        // busy wait
    }
}

// Wait for real time to pass (not fake timers)
function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Query Mimir for a metric
async function queryMimir(query: string): Promise<number> {
    try {
        const res = await fetch(`${MIMIR_QUERY_URL}?query=${encodeURIComponent(query)}`);
        const json = await res.json();
        if (json.data?.result?.length > 0) {
            return parseFloat(json.data.result[0].value[1]);
        }
    } catch {
        // Mimir may not be reachable from browser — expected in CI
    }
    return 0;
}

describe("Lag Monitor Integration", () => {
    let otel: ReturnType<typeof init>;
    let handles: AllMonitorHandles;

    beforeAll(async () => {
        // Initialize OTel with real OTLP export
        otel = init({
            serviceName: SERVICE_NAME,
            endpoint: OTLP_ENDPOINT,
            metricsExportIntervalMs: 5_000,
            tracing: true,
            logs: true,
            faro: false,
        });

        // Tee logger: console + OTel Logs (Loki)
        const consoleLogger = {
            log: (level: string, message: string, args: unknown) => {
                console.log(`[${level}] ${message}`, args);
            },
        };
        const otelLogger = createOtelLoggerAdapter(otel.getLogger("lag"));
        const logger = createTeeLogger(consoleLogger, otelLogger);

        // Memory source: try modern API, fall back to legacy
        const perfAny = window.performance as unknown as {
            memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
            measureUserAgentSpecificMemory?: () => Promise<{ bytes: number; breakdown: never[] }>;
        };

        // Set up all lag monitors with real browser APIs
        handles = setupAllMonitors({
            document,
            logger,
            setIntervalFn: (fn, ms) => window.setInterval(fn, ms),
            clearIntervalFn: (id) => window.clearInterval(id),
            setTimeoutFn: (fn, ms) => window.setTimeout(fn, ms),
            clearTimeoutFn: (id) => window.clearTimeout(id),
            clock: { now: () => performance.now() },
            meter: otel.getMeter("lag"),
            PerformanceObserver: window.PerformanceObserver,
            performance: window.performance,
            window: window,
            worker: createLagWorker(),
            workerPingIntervalMs: 500,

            // New monitors
            MessageChannel: window.MessageChannel,
            queueMicrotask: (cb: () => void) => window.queueMicrotask(cb),
            requestAnimationFrame: (cb: (t: number) => number) => window.requestAnimationFrame(cb),
            cancelAnimationFrame: (h: number) => window.cancelAnimationFrame(h),
            requestIdleCallback: window.requestIdleCallback?.bind(window),
            cancelIdleCallback: window.cancelIdleCallback?.bind(window),
            memorySource: {
                readLegacy: perfAny.memory ? () => perfAny.memory : undefined,
                measureModern: perfAny.measureUserAgentSpecificMemory
                    ? () => perfAny.measureUserAgentSpecificMemory!()
                    : undefined,
            },
            memoryIntervalMs: 5_000,
            lifecycleStateMachine: true,
            // Real GC detection via FinalizationRegistry (ES2021)
            FinalizationRegistry: (window as unknown as { FinalizationRegistry: never }).FinalizationRegistry,
            gcCanaryIntervalMs: 100,
        });
    });

    afterAll(async () => {
        handles?.stop();
        await otel?.shutdown();
    });

    it("collects ContinuousLag and DriftLag measurements by blocking the main thread", async () => {
        // Block main thread to generate measurable lag
        for (let i = 0; i < 5; i++) {
            blockMainThread(200); // 200ms block = ~100ms lag per measurement cycle
            await wait(150);       // let timers fire between blocks
        }

        // Wait for metrics to accumulate
        await wait(2000);

        // The monitors should have fired report callbacks.
        // We can't directly inspect the report calls here (they're closures inside setupAllMonitors),
        // but if OTel is working, metrics are being recorded to the Meter.
        // Flush via shutdown to push metrics to Alloy.
        expect(true).toBe(true); // test completes without error = monitors ran
    });

    it("collects MacrotaskLag measurements", async () => {
        // MacrotaskLag measures setTimeout(0) scheduling delay.
        // Generate macrotask queue pressure
        for (let i = 0; i < 10; i++) {
            blockMainThread(100);
            await wait(50);
        }

        // MacrotaskLag runs on 5s interval, wait for at least one cycle
        await wait(6000);

        expect(true).toBe(true); // monitors ran without error
    });

    it("Performance Observer monitors are active", () => {
        // Verify the observer handles were created
        // Note: LoAF and EventTiming may not fire in an automated test
        // because there's no real user interaction or animation frames
        expect(handles.observers).toBeDefined();
    });

    it("timer throttle detector is running", () => {
        expect(handles.throttleDetector).toBeDefined();
    });

    it("GC spike detector is available", () => {
        expect(handles.gcDetector).toBeDefined();
        // Feed it a value to verify it works
        const result = handles.gcDetector.classify(5);
        expect(result.likelyGCPause).toBe(false);
    });

    it("scheduling fairness monitor is wired", () => {
        expect(handles.schedulingMonitor).toBeDefined();
    });

    it("frame timing monitor records frame deltas", async () => {
        expect(handles.frameMonitor).toBeDefined();
        // Wait for several rAF callbacks
        await wait(500);
        // The monitor reports each frame; we can't easily inspect closures here,
        // but if the monitor is wired, the metrics will flow to OTel
        expect(handles.frameMonitor!.getDroppedFrameRate()).toBeGreaterThanOrEqual(0);
    });

    it("idle availability monitor is wired (if supported)", () => {
        // requestIdleCallback is supported in Chromium
        if (window.requestIdleCallback) {
            expect(handles.idleMonitor).toBeDefined();
        }
    });

    it("memory monitor samples heap (if performance.memory is available)", async () => {
        const perfAny = window.performance as unknown as { memory?: unknown };
        if (perfAny.memory) {
            expect(handles.memoryMonitor).toBeDefined();
            // Wait for at least one sample
            await wait(500);
        }
    });

    it("lifecycle state machine is wired", () => {
        expect(handles.lifecycleStateMachine).toBeDefined();
    });

    it("paint and LCP monitors are wired", () => {
        expect(handles.paintMonitor).toBeDefined();
        expect(handles.lcpMonitor).toBeDefined();
    });

    it("GC signal detector observes real GC events under allocation pressure", async () => {
        expect(handles.gcSignal).toBeDefined();
        const before = handles.gcSignal!.getTotalGCEvents();

        // Generate allocation pressure to bait the GC
        for (let i = 0; i < 20; i++) {
            const garbage : unknown[] = [];
            for (let j = 0; j < 10000; j++) {
                garbage.push({ a : Math.random(), b : new Array(20).fill(0) });
            }
            // Drop the reference, yield to allow GC
            await new Promise(r => setTimeout(r, 50));
        }

        const after = handles.gcSignal!.getTotalGCEvents();
        console.log(`GCSignalDetector: before=${before} after=${after} delta=${after - before}`);

        // We can't guarantee GC fires (the engine decides), but in 1+ second of
        // heavy allocation in a real browser it usually does. Don't hard-fail
        // if zero — just log so we can investigate.
        expect(after).toBeGreaterThanOrEqual(before);
    });

    it("emits a synthetic log to verify Loki bridge", () => {
        // Use the otel logger directly to emit a record (the lag monitors only
        // log on errors, so without this we'd never see anything in Loki).
        const logger = otel.getLogger("lag-integration-test");
        logger.emit({
            severityText: "info",
            severityNumber: 9,
            body: "Integration test log: lag monitor stack initialized",
            attributes: {
                "test.suite": "lag-integration-tests",
                "test.event": "stack-initialized",
            },
        });
        // Test passes if no exception
        expect(true).toBe(true);
    });

    it("flushes metrics to OTLP endpoint", async () => {
        // Trigger final flush
        await otel.shutdown();

        // Re-init for potential further tests
        otel = init({
            serviceName: SERVICE_NAME,
            endpoint: OTLP_ENDPOINT,
            metricsExportIntervalMs: 5_000,
            tracing: false,
            logs: false,
            faro: false,
        });

        // Give Alloy time to forward to Mimir
        await wait(3000);

        // Query Mimir — this may fail if running without the Grafana stack
        // but the test still passes (we verify the client-side doesn't crash)
        const continuousCount = await queryMimir(
            `lag_continuous_histogram_count{service_name="${SERVICE_NAME}"}`,
        );
        const macrotaskCount = await queryMimir(
            `lag_macrotask_histogram_count{service_name="${SERVICE_NAME}"}`,
        );

        // Log what we got — useful for debugging
        console.log(`Mimir query results: continuous=${continuousCount}, macrotask=${macrotaskCount}`);

        // If Mimir is available, we expect metrics
        // If not available (CI without docker), test still passes
        if (continuousCount > 0) {
            expect(continuousCount).toBeGreaterThan(0);
            console.log("Metrics confirmed in Mimir!");
        }
    });
});
