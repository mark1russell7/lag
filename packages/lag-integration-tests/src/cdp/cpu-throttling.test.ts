import { expect } from "vitest";
import { cdp, recordMeasurement } from "../commands.js";
import { median, wait } from "../harness.js";
import { startMonitors, type MonitoredPage } from "./monitors.js";

let sink = 0;

/** A fixed amount of work (not a fixed time). Returns its duration in ms. */
function work(iterations : number) : number {
    const start = performance.now();
    let total = 0;
    for (let i = 0; i < iterations; i++) total += Math.sqrt(i) * Math.sin(i);
    sink += total;
    return performance.now() - start;
}

/** The number of iterations that take about `targetMs` without throttling. */
function calibrate(targetMs : number) : number {
    work(200_000); // let the JIT compile `work`
    let iterations = 100_000;
    for (;;) {
        const ms = work(iterations);
        if (ms >= targetMs / 4) return Math.round(iterations * targetMs / ms);
        iterations *= 2;
    }
}

const BLOCKS = 8;
const GAP_MS = 300;

/**
 * Runs the same work `BLOCKS` times at a throttling rate. For each block,
 * the largest DriftLag sample and the largest heartbeat delay in the gap
 * after it measure that block.
 */
async function phase(page : MonitoredPage, rate : number, iterations : number) {
    await cdp.setCpuThrottling(rate);
    await wait(500);
    const durations : number[] = [];
    const drift : number[] = [];
    const worker : number[] = [];
    for (let i = 0; i < BLOCKS; i++) {
        const start = performance.now();
        durations.push(work(iterations));
        await wait(GAP_MS);
        const end = performance.now();
        drift.push(Math.max(0, ...page.between("lag_drift_histogram", start, end).map(r => r.value)));
        worker.push(Math.max(0, ...page.between("lag_worker_main_block_histogram", start, end).map(r => r.value)));
    }
    return { durations, drift, worker };
}

describe("CPU throttling (CDP Emulation.setCPUThrottlingRate)", () => {
    afterEach(async () => {
        await cdp.resetPage();
    });

    it("4x throttling of the same work increases the drift and the worker lag", async () => {
        // Heartbeats every 25 ms: each block delays at least one heartbeat by most of its length
        const page = startMonitors(25);
        try {
            await wait(1_500);
            const iterations = calibrate(40);
            const normal = await phase(page, 1, iterations);
            const throttled = await phase(page, 4, iterations);
            await cdp.setCpuThrottling(1);

            const summary = (p : typeof normal) => ({
                workMs : median(p.durations).toFixed(1),
                driftMedian : median(p.drift).toFixed(1),
                workerMedian : median(p.worker).toFixed(1),
            });
            console.log(`CPU throttling 1x: ${JSON.stringify(summary(normal))}; 4x: ${JSON.stringify(summary(throttled))}`);
            for (const [rate, p] of [["1x", normal], ["4x", throttled]] as const) {
                await recordMeasurement(`cdp/cpu-${rate}/lag_drift_histogram`, "ms", p.drift, { cpu : rate });
                await recordMeasurement(`cdp/cpu-${rate}/lag_worker_main_block_histogram`, "ms", p.worker, { cpu : rate });
                await recordMeasurement(`cdp/cpu-${rate}/work_duration`, "ms", p.durations, { cpu : rate });
            }

            // The same work takes about 4 times longer (measured: 4.3x to 4.7x)
            expect(median(throttled.durations)).toBeGreaterThan(2.5 * median(normal.durations));
            // Each block adds its length to the drift of its window and delays the heartbeats by its length.
            // The medians of the 8 blocks are robust to one window with false lag (DriftLag.granularity.test.ts).
            expect(median(throttled.drift)).toBeGreaterThan(2.5 * median(normal.drift));
            expect(median(throttled.worker)).toBeGreaterThan(2.5 * median(normal.worker));
        } finally {
            page.stop();
        }
    });
});
