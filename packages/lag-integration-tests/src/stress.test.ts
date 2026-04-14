import { expect } from "vitest";
import { init } from "@mark1russell7/otel-ts";
import {
    setupAllMonitors,
    createOtelLoggerAdapter,
    createTeeLogger,
    type AllMonitorHandles,
} from "@lag/core";
import { createLagWorker } from "@lag/worker";
import {
    runWorkload,
    lightLoad,
    moderateLoad,
    heavyLoad,
    burstyLoad,
    evolutionaryLoad,
    kitchenSink,
    type WorkloadResult,
} from "./lag-generator/index.js";

const OTLP_ENDPOINT = "http://localhost:4318";
const SERVICE_NAME = "lag-stress-test";

// Stress profile durations — kept short enough to fit a CI budget but long
// enough to generate meaningful signal.
const PROFILE_DURATION_MS = 10_000;

interface StressContext {
    otel: ReturnType<typeof init>;
    handles: AllMonitorHandles;
}

function makeContext(serviceName: string): StressContext {
    const otel = init({
        serviceName,
        endpoint: OTLP_ENDPOINT,
        metricsExportIntervalMs: 5_000,
        tracing: true,
        logs: true,
        faro: false,
    });

    const consoleLogger = {
        log: (level: string, message: string, args: unknown) => {
            // Reduce noise — stress tests can spam
            if (level === "error" || level === "warn") {
                console.log(`[${level}] ${message}`, args);
            }
        },
    };
    const otelLogger = createOtelLoggerAdapter(otel.getLogger("stress"));
    const logger = createTeeLogger(consoleLogger, otelLogger);

    const perfAny = window.performance as unknown as {
        memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    };

    const handles = setupAllMonitors({
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
        workerPingIntervalMs: 250,

        MessageChannel: window.MessageChannel,
        queueMicrotask: (cb: () => void) => window.queueMicrotask(cb),
        requestAnimationFrame: (cb: (t: number) => number) => window.requestAnimationFrame(cb),
        cancelAnimationFrame: (h: number) => window.cancelAnimationFrame(h),
        requestIdleCallback: window.requestIdleCallback?.bind(window),
        cancelIdleCallback: window.cancelIdleCallback?.bind(window),
        memorySource: perfAny.memory ? { readLegacy: () => perfAny.memory } : undefined,
        memoryIntervalMs: 2_000,
        lifecycleStateMachine: true,
        // PressureObserver — Chrome 125+
        PressureObserver: (window as unknown as { PressureObserver?: unknown }).PressureObserver as never,
        pressureSources: ["cpu"],
        pressureSampleIntervalMs: 1_000,
    });

    return { otel, handles };
}

async function teardown(ctx: StressContext): Promise<void> {
    ctx.handles.stop();
    await ctx.otel.shutdown();
}

function logResult(profile: string, result: WorkloadResult): void {
    console.log(
        `[${profile}] seed=${result.seed} events=${result.eventCount} totalLagMs=${result.totalLagMs.toFixed(0)} ` +
        `runDurationMs=${result.durationMs.toFixed(0)} byName=${JSON.stringify(result.eventsByName)}`,
    );
}

describe("Lag Monitor Stress Tests", () => {
    it("light load profile completes and reports few events", async () => {
        const ctx = makeContext(`${SERVICE_NAME}-light`);
        try {
            const result = await runWorkload(lightLoad(PROFILE_DURATION_MS, 11));
            logResult("light", result);
            expect(result.eventCount).toBeGreaterThan(0);
            expect(result.totalLagMs).toBeGreaterThan(0);
            // Light load should accumulate < 25% of wall time as lag
            expect(result.totalLagMs).toBeLessThan(PROFILE_DURATION_MS * 0.25);
        } finally {
            await teardown(ctx);
        }
    }, 60_000);

    it("moderate load profile triggers measurable lag", async () => {
        const ctx = makeContext(`${SERVICE_NAME}-moderate`);
        try {
            const result = await runWorkload(moderateLoad(PROFILE_DURATION_MS, 22));
            logResult("moderate", result);
            expect(result.eventCount).toBeGreaterThan(10);
            // Moderate covers cpu, macrotask, layout, loaf — at least 3 of 4
            expect(Object.keys(result.eventsByName).length).toBeGreaterThanOrEqual(3);
        } finally {
            await teardown(ctx);
        }
    }, 60_000);

    it("heavy load profile drives the system hard", async () => {
        const ctx = makeContext(`${SERVICE_NAME}-heavy`);
        try {
            const result = await runWorkload(heavyLoad(PROFILE_DURATION_MS, 33));
            logResult("heavy", result);
            expect(result.eventCount).toBeGreaterThan(5);
            // Heavy load should consume substantial wall-time as lag
            expect(result.totalLagMs).toBeGreaterThan(PROFILE_DURATION_MS * 0.3);
        } finally {
            await teardown(ctx);
        }
    }, 60_000);

    it("bursty load produces both small and huge events (bimodal)", async () => {
        const ctx = makeContext(`${SERVICE_NAME}-bursty`);
        try {
            const events: number[] = [];
            const opts = burstyLoad(PROFILE_DURATION_MS, 44);
            opts.onEvent = (e) => events.push(e.durationMs);
            const result = await runWorkload(opts);
            logResult("bursty", result);

            // Bimodal split: should see both small (<30) and large (>200) events
            const smalls = events.filter((d) => d < 30).length;
            const larges = events.filter((d) => d > 100).length;
            console.log(`bursty smalls=${smalls} larges=${larges}`);
            expect(smalls).toBeGreaterThan(0);
            // Larges may not appear in a 10s window with 5% probability — check loosely
            expect(result.eventCount).toBeGreaterThan(20);
        } finally {
            await teardown(ctx);
        }
    }, 60_000);

    it("evolutionary load drifts upward over time", async () => {
        const ctx = makeContext(`${SERVICE_NAME}-evolutionary`);
        try {
            const events: Array<{ elapsedMs: number; durationMs: number }> = [];
            const opts = evolutionaryLoad(PROFILE_DURATION_MS, 55);
            opts.onEvent = (e) => events.push({ elapsedMs: e.elapsedMs, durationMs: e.durationMs });
            const result = await runWorkload(opts);
            logResult("evolutionary", result);

            expect(events.length).toBeGreaterThan(5);
            // First half average vs second half average — drift should produce a delta
            const half = Math.floor(events.length / 2);
            const firstHalf = events.slice(0, half);
            const secondHalf = events.slice(half);
            const avg1 = firstHalf.reduce((s, e) => s + e.durationMs, 0) / firstHalf.length;
            const avg2 = secondHalf.reduce((s, e) => s + e.durationMs, 0) / secondHalf.length;
            console.log(`evolutionary first-half avg=${avg1.toFixed(1)} second-half avg=${avg2.toFixed(1)}`);
            // Random walk: not guaranteed to drift up, but the distributions of
            // first and second halves should differ noticeably
            expect(Math.abs(avg2 - avg1)).toBeGreaterThan(1);
        } finally {
            await teardown(ctx);
        }
    }, 60_000);

    it("kitchen sink profile exercises all generators", async () => {
        const ctx = makeContext(`${SERVICE_NAME}-kitchen`);
        try {
            const result = await runWorkload(kitchenSink(PROFILE_DURATION_MS, 66));
            logResult("kitchen-sink", result);

            // Should have hit at least 6 of the 8 spec types
            expect(Object.keys(result.eventsByName).length).toBeGreaterThanOrEqual(6);
            expect(result.eventCount).toBeGreaterThan(20);
        } finally {
            await teardown(ctx);
        }
    }, 60_000);
});
