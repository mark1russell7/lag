import { describe, expect, it } from "vitest";
import { closedLoopSamples, openLoopSamples, randomEventDelay, statisticsOf, type ProbeScenario } from "./probe-model";

/** The worked example of the statistics page: 60 s, with a block from 15 s to 45 s. */
const EXAMPLE : ProbeScenario = {
    periodMs : 60_000,
    block : { start : 15_000, duration : 30_000 },
    windowMs : 100,
    heartbeatMs : 1_000,
};

describe("closedLoopSamples", () => {
    it("gives one window with the whole block, and windows of 0 ms in the idle time", () => {
        const samples = closedLoopSamples(EXAMPLE);
        expect(samples).toHaveLength(300);
        expect(samples.filter(sample => sample.value > 0)).toEqual([{ time : 45_100, value : 30_000 }]);
        expect(samples.at(-1)!.time).toBeCloseTo(60_000, 6);
    });

    it("gives the statistics of the table of the statistics page", () => {
        const statistics = statisticsOf(closedLoopSamples(EXAMPLE));
        expect(statistics).toEqual({ count : 300, longCount : 1, p95 : 0, mean : 100, sum : 30_000 });
    });

    it("gives only idle windows without a block", () => {
        const samples = closedLoopSamples({ ...EXAMPLE, block : { start : 10_000, duration : 0 } });
        expect(samples).toHaveLength(600);
        expect(samples.every(sample => sample.value === 0)).toBe(true);
    });
});

describe("openLoopSamples", () => {
    it("gives the delays 30 s, 29 s and so on to 1 s for the heartbeats in the block", () => {
        const samples = openLoopSamples(EXAMPLE);
        expect(samples).toHaveLength(60);
        const delayed = samples.filter(sample => sample.value > 0);
        expect(delayed.map(sample => sample.value)).toEqual(Array.from({ length : 30 }, (_, index) => 30_000 - index * 1_000));
        expect(delayed[0]!.time).toBe(15_000);
    });

    it("gives the statistics of the table of the statistics page", () => {
        const statistics = statisticsOf(openLoopSamples(EXAMPLE));
        expect(statistics.count).toBe(60);
        expect(statistics.longCount).toBe(30);
        expect(statistics.p95).toBe(27_000);
        expect(statistics.mean).toBe(7_750);
    });

    it("cuts the block at the end of the period", () => {
        const samples = openLoopSamples({ ...EXAMPLE, block : { start : 58_000, duration : 10_000 } });
        expect(samples.filter(sample => sample.value > 0).map(sample => sample.value)).toEqual([2_000, 1_000]);
    });
});

describe("randomEventDelay", () => {
    it("is L² / 2 / T: 7.5 s for the example", () => {
        expect(randomEventDelay(EXAMPLE)).toBe(7_500);
    });
});
