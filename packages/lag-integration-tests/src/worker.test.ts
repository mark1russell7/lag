import { expect, vi } from "vitest";
import { createLagWorker } from "@render/lag-worker";
import { WorkerLagMonitor, type WorkerLagMeasurement } from "@render/lag";

function wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

describe("Worker Lag Monitor Integration", () => {
    it("receives real pong measurements from a Web Worker", async () => {
        const measurements: WorkerLagMeasurement[] = [];
        const logger = { log: vi.fn() };

        const worker = createLagWorker();

        const monitor = new WorkerLagMonitor(
            worker,
            (m) => measurements.push(m),
            logger,
            (fn, ms) => window.setInterval(fn, ms),
            (id) => window.clearInterval(id),
            { now: () => performance.now() },
            500, // ping every 500ms
        );

        // Wait for a few ping/pong cycles
        await wait(3000);

        monitor.stop();

        console.log(`Received ${measurements.length} worker measurements`);
        if (measurements.length > 0) {
            console.log("Sample:", JSON.stringify(measurements[0]));
        }

        // Should have received at least a few measurements
        expect(measurements.length).toBeGreaterThan(0);

        // Round-trip should be reasonable (< 100ms in a non-throttled environment)
        const avgRoundTrip = measurements.reduce((s, m) => s + m.roundTripMs, 0) / measurements.length;
        console.log(`Average round-trip: ${avgRoundTrip.toFixed(2)}ms`);
        expect(avgRoundTrip).toBeLessThan(100);

        // Estimated main block should be non-negative
        for (const m of measurements) {
            expect(m.estimatedMainBlockMs).toBeGreaterThanOrEqual(0);
        }
    });

    it("detects main thread blocking via worker comparison", async () => {
        const measurements: WorkerLagMeasurement[] = [];
        const logger = { log: vi.fn() };

        const worker = createLagWorker();

        const monitor = new WorkerLagMonitor(
            worker,
            (m) => measurements.push(m),
            logger,
            (fn, ms) => window.setInterval(fn, ms),
            (id) => window.clearInterval(id),
            { now: () => performance.now() },
            200, // ping every 200ms
        );

        // Wait for baseline measurements
        await wait(1500);
        const baselineCount = measurements.length;

        // Block main thread — worker should detect the delay
        const start = performance.now();
        while (performance.now() - start < 500) {
            // busy wait 500ms
        }

        // Wait for blocked pongs to arrive
        await wait(1500);

        monitor.stop();

        // Measurements after baseline should show elevated round-trip
        const postBlockMeasurements = measurements.slice(baselineCount);
        console.log(`Post-block measurements: ${postBlockMeasurements.length}`);

        if (postBlockMeasurements.length > 0) {
            const maxRoundTrip = Math.max(...postBlockMeasurements.map(m => m.roundTripMs));
            console.log(`Max round-trip after block: ${maxRoundTrip.toFixed(2)}ms`);

            // During the 500ms block, at least one round-trip should be elevated
            expect(maxRoundTrip).toBeGreaterThan(50);
        }
    });
});
