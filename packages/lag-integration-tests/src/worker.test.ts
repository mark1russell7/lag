import { expect, vi } from "vitest";
import { createLagWorker, type LagWorker } from "@lag/worker";
import { WorkerLagMonitor, createAbsoluteClock, type WorkerLagMeasurement } from "@lag/core";
import { blockMainThread, wait } from "./harness.js";

describe("Worker Lag Monitor Integration", () => {
    const workers : LagWorker[] = [];

    function createMonitor(intervalMs : number) {
        const measurements : WorkerLagMeasurement[] = [];
        const worker = createLagWorker();
        workers.push(worker);
        const monitor = new WorkerLagMonitor(
            worker,
            (m) => measurements.push(m),
            { log : vi.fn() },
            createAbsoluteClock(window.performance),
            {
                heartbeatIntervalMs : intervalMs,
                setTimeoutFn : (fn, ms) => window.setTimeout(fn, ms),
                clearTimeoutFn : (id) => window.clearTimeout(id),
                hang : { thresholdMs : 5_000 },
            },
        );
        return { monitor, measurements };
    }

    afterAll(() => {
        for (const worker of workers) worker.terminate();
    });

    it("receives heartbeats from a real Web Worker", async () => {
        const { monitor, measurements } = createMonitor(100);
        await wait(1_500);
        monitor.stop();

        console.log(`Received ${measurements.length} heartbeats; sample: ${JSON.stringify(measurements[0])}`);
        expect(measurements.length).toBeGreaterThanOrEqual(8);
        expect(measurements.map(m => m.seq)).toEqual(measurements.map((_, i) => i + 1));

        // An idle main thread handles heartbeats promptly
        const avgDelay = measurements.reduce((s, m) => s + m.deliveryDelayMs, 0) / measurements.length;
        console.log(`Average delivery delay: ${avgDelay.toFixed(2)}ms`);
        expect(avgDelay).toBeLessThan(20);
    });

    it("detects main thread blocking", async () => {
        const { monitor, measurements } = createMonitor(50);
        await wait(500);
        const baselineCount = measurements.length;

        blockMainThread(800);
        await wait(300);
        monitor.stop();

        const afterBlock = measurements.slice(baselineCount).map(m => m.deliveryDelayMs);
        console.log(`Delivery delays after an 800ms block: ${afterBlock.map(d => d.toFixed(0)).join(", ")}`);
        // ~16 heartbeats queued during the block; the first waited for most of it
        expect(afterBlock.length).toBeGreaterThanOrEqual(10);
        expect(Math.max(...afterBlock)).toBeGreaterThan(600);
    });

    it("stops and restarts the worker's heartbeat loop", async () => {
        const { monitor, measurements } = createMonitor(50);
        await wait(300);
        monitor.stop();
        await wait(100); // already-posted heartbeats drain
        const stoppedAt = measurements.length;

        await wait(500);
        expect(measurements.length).toBe(stoppedAt);

        monitor.start();
        await wait(300);
        monitor.stop();
        expect(measurements.length).toBeGreaterThan(stoppedAt);
    });
});
