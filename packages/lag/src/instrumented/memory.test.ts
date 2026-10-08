import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstrumentedMemory } from "./memory.js";
import { createRecordingMeter, expectCatalogInstruments } from "../test-utils.js";
import type { MemorySource } from "../MemoryMonitor.js";

function setup(memorySource : MemorySource, memoryIntervalMs? : number) {
    const meter = createRecordingMeter();
    const handle = createInstrumentedMemory({
        logger : { log : vi.fn() },
        clock : { now : () => 0 },
        meter : meter.meter,
        memorySource,
        setIntervalFn : (fn, ms) => setInterval(fn, ms) as unknown as number,
        clearIntervalFn : (id) => clearInterval(id),
        ...(memoryIntervalMs !== undefined ? { memoryIntervalMs } : {}),
    });
    return { meter, handle };
}

describe("createInstrumentedMemory", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("records the used heap with its source, and the usage ratio of the legacy source", async () => {
        const t = setup({ readLegacy : () => ({ usedJSHeapSize : 25, totalJSHeapSize : 50, jsHeapSizeLimit : 100 }) });
        await vi.advanceTimersByTimeAsync(0);
        t.handle.stop();

        expect(t.meter.records().get("lag_memory_used_bytes_histogram")).toEqual([{ value : 25, attributes : { source : "legacy" } }]);
        expect(t.meter.values("lag_memory_usage_ratio_histogram")).toEqual([0.25]);
    });

    it("records no usage ratio for the modern source, because it gives no limit", async () => {
        const t = setup({ measureModern : () => Promise.resolve({ bytes : 4_096, breakdown : [] }) });
        await vi.advanceTimersByTimeAsync(0);
        t.handle.stop();

        expect(t.meter.records().get("lag_memory_used_bytes_histogram")).toEqual([{ value : 4_096, attributes : { source : "modern" } }]);
        expect(t.meter.values("lag_memory_usage_ratio_histogram")).toEqual([]);
        expectCatalogInstruments(t.meter);
    });

    it("samples at the interval of the dependencies", async () => {
        const t = setup({ readLegacy : () => ({ usedJSHeapSize : 25, totalJSHeapSize : 50, jsHeapSizeLimit : 100 }) }, 1_000);
        await vi.advanceTimersByTimeAsync(1_000);
        t.handle.stop();

        // The monitor takes one sample at the start and one after 1000 ms
        expect(t.meter.values("lag_memory_used_bytes_histogram")).toEqual([25, 25]);
    });
});
