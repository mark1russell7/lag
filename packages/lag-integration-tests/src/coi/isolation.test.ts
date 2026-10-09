import { expect } from "vitest";
import { ClockReliabilityChecker, createNoopMeter, setupAllMonitors, type AllMonitorHandles } from "@mark1russell7/lag";
import { createLagWorker, type LagWorker } from "@mark1russell7/lag/worker";
import { blockMainThread, createBrowserDeps, createRecordingLogger, createTeeMeter, wait, waitUntil, type TeeMeter } from "../harness.js";
import { features } from "../features.js";
import { recordMeasurement } from "../commands.js";

/**
 * The coi project serves every file with COOP same-origin and COEP
 * require-corp, so the page is cross-origin isolated. That gives
 * SharedArrayBuffer (the shared-memory liveness watcher), the fine
 * performance.now() clock and, in Chromium, measureUserAgentSpecificMemory().
 */
describe("A cross-origin-isolated page", () => {
    let handles : AllMonitorHandles;
    let tee : TeeMeter;
    let worker : LagWorker;

    beforeAll(() => {
        tee = createTeeMeter(createNoopMeter());
        worker = createLagWorker();
        handles = setupAllMonitors(createBrowserDeps({
            logger : createRecordingLogger(),
            meter : tee.meter,
            worker,
            memoryIntervalMs : 60_000,
        }));
    });

    afterAll(() => {
        handles?.stop();
        worker?.terminate();
    });

    it("is cross-origin isolated and has SharedArrayBuffer", () => {
        expect(globalThis.crossOriginIsolated).toBe(true);
        expect(typeof SharedArrayBuffer).toBe("function");
    });

    it("the shared-memory liveness monitor reports a main-thread block", async () => {
        expect(handles.registry.get("shared-liveness")?.monitor).toBeDefined();
        // The watcher polls the counter every 5 ms; DriftLag's timer beats it
        await wait(700);
        expect(tee.values("lag_liveness_block_histogram")).toEqual([]);

        blockMainThread(300);
        expect(await waitUntil(() => tee.values("lag_liveness_block_histogram").length > 0, 2_000)).toBe(true);
        await wait(200);

        const blocks = tee.values("lag_liveness_block_histogram");
        console.log(`Liveness blocks after a 300 ms block: ${blocks.map(b => b.toFixed(1)).join(", ")}`);
        await recordMeasurement("coi/block-300ms/lag_liveness_block_histogram", "ms", blocks, { scenario : "block-300ms" });
        // The block, plus or minus one DriftLag step (the beat) and one poll of the watcher. Each is
        // about 5 ms in Chromium and up to 16 ms in Firefox and WebKit on Windows (the system tick).
        // Measured: 305 ms (Chromium), 288 ms (Firefox), 330 ms (WebKit). The upper limit leaves
        // 70 ms for a late timer on a busy machine.
        expect(blocks).toHaveLength(1);
        expect(blocks[0]).toBeGreaterThan(260);
        expect(blocks[0]).toBeLessThan(400);
    });

    it("the memory monitor uses measureUserAgentSpecificMemory()", async (ctx) => {
        ctx.skip(!features.measureUserAgentSpecificMemory.supported, features.measureUserAgentSpecificMemory.reason);
        // The first sample starts at once. The coi project starts Chromium with ForceEagerMeasureMemory, so the
        // promise resolves at once (by default it waits for the next garbage collection, up to about 20 s).
        expect(await waitUntil(() => tee.records("lag_memory_used_bytes_histogram").length > 0, 5_000)).toBe(true);
        const sample = tee.records("lag_memory_used_bytes_histogram")[0]!;
        console.log(`measureUserAgentSpecificMemory: ${(sample.value / 1e6).toFixed(1)} MB`);
        expect(sample.attributes).toEqual({ source : "modern" });
        expect(sample.value).toBeGreaterThan(1_000_000);
    });

    it("performance.now() has a high resolution", async () => {
        const checker = new ClockReliabilityChecker(performance);
        const resolution = checker.getResolutionMs();
        console.log(`performance.now() resolution: ${(resolution * 1000).toFixed(1)} µs`);
        await recordMeasurement("coi/clock/lag_clock_resolution_histogram", "ms", [resolution]);
        // 5 µs in Chromium, 20 µs in Firefox and WebKit, against 100 µs to 1 ms without isolation
        expect(checker.isHighResolution()).toBe(true);
        expect(resolution).toBeLessThanOrEqual(0.02 + 1e-9);
    });
});
