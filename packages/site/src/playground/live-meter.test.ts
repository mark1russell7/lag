import { describe, expect, it } from "vitest";
import { LiveMeter } from "./live-meter";

function meterAt(times : number[]) : LiveMeter {
    let index = 0;
    return new LiveMeter({ now : () => times[Math.min(index++, times.length - 1)] ?? 0, capacity : 3 });
}

describe("LiveMeter", () => {
    it("keeps histogram values with their time and attributes", () => {
        const meter = meterAt([10, 20]);
        const histogram = meter.createHistogram<{ source : string }>("h", { unit : "ms" });
        histogram.record(5);
        histogram.record(7, { source : "legacy" });
        const reading = meter.read("h");
        expect(reading).toMatchObject({ kind : "histogram", unit : "ms", count : 2, total : 12 });
        expect(reading?.samples).toEqual([{ t : 10, value : 5 }, { t : 20, value : 7, attributes : { source : "legacy" } }]);
    });

    it("sums counter values", () => {
        const meter = meterAt([1]);
        const counter = meter.createCounter("c", { unit : "{gc}" });
        counter.add(1);
        counter.add(2);
        expect(meter.read("c")?.total).toBe(3);
    });

    it("keeps only the newest samples, but counts all of them", () => {
        const meter = meterAt([1, 2, 3, 4]);
        const histogram = meter.createHistogram("h", { unit : "ms" });
        for (const value of [1, 2, 3, 4]) histogram.record(value);
        expect(meter.read("h")?.samples.map(sample => sample.value)).toEqual([2, 3, 4]);
        expect(meter.read("h")?.count).toBe(4);
        expect(meter.samplesSince("h", 3).map(sample => sample.value)).toEqual([3, 4]);
    });

    it("shares one instrument for the same name", () => {
        const meter = meterAt([1]);
        meter.createHistogram("h", { unit : "ms" }).record(1);
        meter.createHistogram("h", { unit : "ms" }).record(2);
        expect(meter.read("h")?.count).toBe(2);
        expect(meter.names()).toEqual(["h"]);
    });
});
