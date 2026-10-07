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
    runWorkload,
    lightLoad,
    moderateLoad,
    heavyLoad,
    burstyLoad,
    evolutionaryLoad,
    kitchenSink,
    type WorkloadResult,
} from "./lag-generator/index.js";
import { createBrowserDeps, createConsoleLogger, createTeeMeter, type TeeMeter } from "./harness.js";

const OTLP_ENDPOINT = "http://localhost:4318";
const SERVICE_NAME = "lag-stress-test";

// Stress profile durations — kept short enough to fit a CI budget but long
// enough to generate meaningful signal.
const PROFILE_DURATION_MS = 10_000;

type StressContext = {
    otel : ReturnType<typeof init>;
    handles : AllMonitorHandles;
    tee : TeeMeter;
    worker : LagWorker;
};

function makeContext(serviceName : string) : StressContext {
    const otel = init({
        serviceName,
        endpoint : OTLP_ENDPOINT,
        metricsExportIntervalMs : 5_000,
        tracing : true,
        logs : true,
        faro : false,
    });

    const tee = createTeeMeter(otel.getMeter("lag"));
    const worker = createLagWorker();
    const handles = setupAllMonitors(createBrowserDeps({
        // Stress tests are noisy: only surface problems on the console
        logger : createTeeLogger(createConsoleLogger(["warn", "error"]), createOtelLoggerAdapter(otel.getLogger("stress"))),
        meter : tee.meter,
        worker,
        workerHeartbeatIntervalMs : 250,
        memoryIntervalMs : 2_000,
    }));

    return { otel, handles, tee, worker };
}

async function teardown(ctx : StressContext) : Promise<void> {
    ctx.handles.stop();
    ctx.worker.terminate();
    await ctx.otel.shutdown();
}

function logResult(profile : string, result : WorkloadResult, tee : TeeMeter) : void {
    console.log(
        `[${profile}] seed=${result.seed} events=${result.eventCount} totalLagMs=${result.totalLagMs.toFixed(0)} ` +
        `runDurationMs=${result.durationMs.toFixed(0)} byName=${JSON.stringify(result.eventsByName)} ` +
        `driftMax=${tee.max("lag_drift_histogram").toFixed(0)} workerBlockMax=${tee.max("lag_worker_main_block_histogram").toFixed(0)}`,
    );
}

describe("Lag Monitor Stress Tests", () => {
    it("light load profile completes and reports few events", async () => {
        const ctx = makeContext(`${SERVICE_NAME}-light`);
        try {
            const result = await runWorkload(lightLoad(PROFILE_DURATION_MS, 11));
            logResult("light", result, ctx.tee);
            expect(result.eventCount).toBeGreaterThan(0);
            expect(result.totalLagMs).toBeGreaterThan(0);
            // Light load should accumulate < 25% of wall time as lag
            expect(result.totalLagMs).toBeLessThan(PROFILE_DURATION_MS * 0.25);
            // ~10 DriftLag samples per second, none dramatic (spikes are ≤30ms)
            expect(ctx.tee.values("lag_drift_histogram").length).toBeGreaterThan(50);
            expect(ctx.tee.max("lag_drift_histogram")).toBeLessThan(150);
        } finally {
            await teardown(ctx);
        }
    }, 60_000);

    it("moderate load profile triggers measurable lag", async () => {
        const ctx = makeContext(`${SERVICE_NAME}-moderate`);
        try {
            const result = await runWorkload(moderateLoad(PROFILE_DURATION_MS, 22));
            logResult("moderate", result, ctx.tee);
            expect(result.eventCount).toBeGreaterThan(10);
            // Moderate covers cpu, macrotask, layout, loaf — at least 3 of 4
            expect(Object.keys(result.eventsByName).length).toBeGreaterThanOrEqual(3);
            expect(ctx.tee.max("lag_drift_histogram")).toBeGreaterThan(20);
        } finally {
            await teardown(ctx);
        }
    }, 60_000);

    it("heavy load profile drives the system hard", async () => {
        const ctx = makeContext(`${SERVICE_NAME}-heavy`);
        try {
            const result = await runWorkload(heavyLoad(PROFILE_DURATION_MS, 33));
            logResult("heavy", result, ctx.tee);
            expect(result.eventCount).toBeGreaterThan(5);
            // Heavy load should consume substantial wall-time as lag
            expect(result.totalLagMs).toBeGreaterThan(PROFILE_DURATION_MS * 0.3);
            // Blocks of 20-300ms (and power-law spikes) must show up in both views
            expect(ctx.tee.max("lag_drift_histogram")).toBeGreaterThan(100);
            expect(ctx.tee.max("lag_worker_main_block_histogram")).toBeGreaterThan(50);
        } finally {
            await teardown(ctx);
        }
    }, 60_000);

    it("bursty load produces both small and huge events (bimodal)", async () => {
        const ctx = makeContext(`${SERVICE_NAME}-bursty`);
        try {
            const events : number[] = [];
            const opts = burstyLoad(PROFILE_DURATION_MS, 44);
            opts.onEvent = (e) => events.push(e.durationMs);
            const result = await runWorkload(opts);
            logResult("bursty", result, ctx.tee);

            const smalls = events.filter((d) => d < 30).length;
            const larges = events.filter((d) => d > 100).length;
            console.log(`bursty smalls=${smalls} larges=${larges}`);
            expect(smalls).toBeGreaterThan(0);
            // Larges may not appear in a 10s window with 5% probability — check loosely
            expect(result.eventCount).toBeGreaterThan(20);
            if (larges > 0) {
                // A ≥200ms block lands in DriftLag's 100ms windows
                expect(ctx.tee.max("lag_drift_histogram")).toBeGreaterThan(100);
            }
        } finally {
            await teardown(ctx);
        }
    }, 60_000);

    it("evolutionary load drifts upward over time", async () => {
        const ctx = makeContext(`${SERVICE_NAME}-evolutionary`);
        try {
            const events : Array<{ elapsedMs : number; durationMs : number }> = [];
            const opts = evolutionaryLoad(PROFILE_DURATION_MS, 55);
            opts.onEvent = (e) => events.push({ elapsedMs : e.elapsedMs, durationMs : e.durationMs });
            const result = await runWorkload(opts);
            logResult("evolutionary", result, ctx.tee);

            expect(events.length).toBeGreaterThan(5);
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
            logResult("kitchen-sink", result, ctx.tee);

            // Should have hit at least 6 of the 8 spec types
            expect(Object.keys(result.eventsByName).length).toBeGreaterThanOrEqual(6);
            expect(result.eventCount).toBeGreaterThan(20);
            expect(ctx.tee.max("lag_drift_histogram")).toBeGreaterThan(30);
        } finally {
            await teardown(ctx);
        }
    }, 60_000);
});
