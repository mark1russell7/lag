import { expect, inject } from "vitest";
import { setupAllMonitors } from "@mark1russell7/lag";
import { createLagWorker } from "@mark1russell7/lag/worker";
import { kitchenSink, runWorkload } from "@lag/load";
import { cdp, recordBudget, recordMeasurement } from "../commands.js";
import { countWorkerMessages, createBrowserDeps, createRecordingLogger, createSummaryMeter, createTimerAccounting, wait } from "../harness.js";

/**
 * The soak test (opt-in: pnpm test:soak). All monitors and a worker run for
 * LAG_SOAK_MS (default 3 minutes) under the mixed kitchen-sink workload of
 * @lag/load. Every 15 s the test runs a full garbage collection
 * (HeapProfiler.collectGarbage) and reads the used heap (Runtime.getHeapUsage).
 *
 * The heap must not grow without limit: the monitors keep bounded state (the
 * 10 longest interactions, the reliability intervals of the last 120 s, the
 * last 100 timer steps). At the end, stop() must leave no timer, interval,
 * animation frame or idle callback, and the worker must stop its heartbeats.
 */

const SOAK_MS = inject("soakMs");
const SEGMENT_MS = 15_000;
/** The first minute fills the bounded buffers; the trend counts from then. */
const WARMUP_MS = 60_000;
/**
 * More than 100 kB of growth each minute after the warmup (6 MB each hour)
 * is a leak. Measured: 9 kB/min in 3 minutes, 9.46 to 9.52 MB after GC. The
 * heap after a full GC varies by about 20 kB between samples, so the slope of
 * 8 or more samples has a noise of about 10 kB/min.
 */
const MAX_SLOPE_BYTES_PER_MINUTE = 100_000;

type HeapSample = { minute : number; used : number };

/** The least-squares slope of `used` against `minute`, in bytes each minute. */
function slope(samples : readonly HeapSample[]) : number {
    const n = samples.length;
    if (n < 2) return 0;
    const meanX = samples.reduce((s, p) => s + p.minute, 0) / n;
    const meanY = samples.reduce((s, p) => s + p.used, 0) / n;
    const covariance = samples.reduce((s, p) => s + (p.minute - meanX) * (p.used - meanY), 0);
    const variance = samples.reduce((s, p) => s + (p.minute - meanX) ** 2, 0);
    return variance === 0 ? 0 : covariance / variance;
}

describe("Soak: all monitors under a mixed workload", () => {
    it(`keep a bounded heap for ${(SOAK_MS / 60_000).toFixed(1)} minutes and stop cleanly`, async () => {
        const accounting = createTimerAccounting();
        const meter = createSummaryMeter();
        const logger = createRecordingLogger();
        const worker = countWorkerMessages(createLagWorker());
        const handles = setupAllMonitors(createBrowserDeps({
            logger,
            meter : meter.meter,
            worker : worker.worker,
            workerHeartbeatIntervalMs : 250,
            memoryIntervalMs : 5_000,
        }, accounting.globals));

        const start = performance.now();
        const heap : HeapSample[] = [];
        const sampleHeap = async () : Promise<void> => {
            await cdp.collectGarbage();
            const { usedSize } = await cdp.getHeapUsage();
            heap.push({ minute : (performance.now() - start) / 60_000, used : usedSize });
        };

        let pendingPeak = 0;
        try {
            await wait(2_000);
            await sampleHeap();
            for (let seed = 1; performance.now() - start < SOAK_MS; seed++) {
                const left = SOAK_MS - (performance.now() - start);
                await runWorkload(kitchenSink(Math.min(SEGMENT_MS, left), seed));
                await sampleHeap();
                const pending = accounting.pending();
                pendingPeak = Math.max(pendingPeak, pending.timeouts + pending.intervals + pending.animationFrames + pending.idleCallbacks);
            }
        } finally {
            handles.stop();
        }

        // stop() released everything that the monitors scheduled
        await wait(500);
        expect(accounting.pending()).toEqual({ timeouts : 0, intervals : 0, animationFrames : 0, idleCallbacks : 0 });
        expect(handles.registry.size).toBe(0);
        // The worker stopped its heartbeats: no message in the next 1.5 s
        worker.reset();
        await wait(1_500);
        expect(worker.count()).toBe(0);
        worker.worker.terminate();

        const afterWarmup = heap.filter(sample => sample.minute * 60_000 >= WARMUP_MS);
        const trend = slope(afterWarmup.length >= 3 ? afterWarmup : heap);
        const first = heap[0]!.used;
        const last = heap.at(-1)!.used;
        const max = Math.max(...heap.map(sample => sample.used));
        console.log(`Soak ${(SOAK_MS / 60_000).toFixed(1)} min: heap after GC ${(first / 1e6).toFixed(2)} -> ${(last / 1e6).toFixed(2)} MB ` +
            `(max ${(max / 1e6).toFixed(2)} MB), trend after the warmup ${(trend / 1e3).toFixed(1)} kB/min; ` +
            `samples: ${heap.map(s => `${s.minute.toFixed(2)}:${(s.used / 1e6).toFixed(2)}`).join(" ")}; ` +
            `drift samples ${meter.count("lag_drift_histogram")} (max ${meter.max("lag_drift_histogram").toFixed(0)} ms), ` +
            `heartbeats ${meter.count("lag_worker_main_block_histogram")}, pending timers at most ${pendingPeak}, errors ${logger.messages.filter(m => m.level === "error").length}`);

        await recordMeasurement("soak/heap/js_heap_used_after_gc", "By", heap.map(sample => sample.used));
        await recordBudget({ name : "Soak: heap growth after the warmup, after GC", unit : "kB/min", value : trend / 1_000, limit : MAX_SLOPE_BYTES_PER_MINUTE / 1_000 });

        expect(logger.messages.filter(message => message.level === "error")).toEqual([]);
        expect(meter.count("lag_drift_histogram")).toBeGreaterThan(SOAK_MS / 1_000);
        // The monitors keep a few timers at a time, never more as time goes on
        expect(pendingPeak).toBeLessThan(20);
        expect(trend).toBeLessThan(MAX_SLOPE_BYTES_PER_MINUTE);
    });
});
