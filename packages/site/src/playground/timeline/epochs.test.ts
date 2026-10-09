import { describe, expect, it } from "vitest";
import { blockEpisodes, binStat, DEFAULT_EPOCH_OPTIONS, epochAverages, reportedLagIn, tCritical95 } from "./epochs";
import { frame, interaction, span, testModel } from "./fixtures";
import type { TimedValue } from "./model";

describe("blockEpisodes", () => {
    it("joins a frame, a hang and a stall of the same block into one episode", () => {
        const episodes = blockEpisodes({
            frames : [frame(10, 6_100, 6_050), frame(20, 300, 250)],
            hangs : [span("h", "hang", 10.02, 16.08)],
            stalls : [span("s", "stall", 9.95, 16.15, { kind : "hang" })],
        });
        expect(episodes).toEqual([
            { start : 9.95, end : 16.15, sources : ["stall", "frame", "hang"] },
            { start : 20, end : 20.3, sources : ["frame"] },
        ]);
    });

    it("ignores a frame that blocks less than the threshold, and a stall of a suspend", () => {
        expect(blockEpisodes({ frames : [frame(1, 120, 70)], hangs : [], stalls : [span("s", "stall", 5, 70, { kind : "suspend" })] })).toEqual([]);
        expect(blockEpisodes({ frames : [frame(1, 120, 70)], hangs : [], stalls : [] }, 50)).toHaveLength(1);
    });

    it("joins blocks that are less than the gap apart", () => {
        const frames = [frame(1, 200, 150), frame(1.22, 200, 150), frame(2, 200, 150)];
        expect(blockEpisodes({ frames, hangs : [], stalls : [] }).map(episode => [episode.start, episode.end])).toEqual([[1, 1.42], [2, 2.2]]);
    });
});

describe("tCritical95", () => {
    it("gives the critical values of the t distribution", () => {
        expect(tCritical95(1)).toBe(12.706);
        expect(tCritical95(10)).toBe(2.228);
        expect(tCritical95(30)).toBe(2.042);
        expect(tCritical95(35)).toBeCloseTo(2.030, 3);
        expect(tCritical95(1e9)).toBeCloseTo(1.96, 3);
        expect(tCritical95(0)).toBeNaN();
    });
});

describe("binStat", () => {
    it("gives the mean, and the interval only for 3 or more values", () => {
        expect(binStat([])).toBeUndefined();
        expect(binStat([4, 6])).toEqual({ n : 2, mean : 5, lower : undefined, upper : undefined });
        const stat = binStat([10, 20, 30])!;
        // The standard error is 10 / √3, and t(2) = 4.303
        expect(stat.mean).toBe(20);
        expect(stat.upper! - stat.mean).toBeCloseTo(4.303 * 10 / Math.sqrt(3), 6);
        expect(stat.mean - stat.lower!).toBeCloseTo(stat.upper! - stat.mean, 9);
    });
});

/** Drift windows that end each 100 ms, at 0.15 s, 0.25 s and so on to `to`, with the lag `lagAt(t)`. */
function driftSeries(to : number, lagAt : (t : number) => number) : TimedValue[] {
    const points : TimedValue[] = [];
    for (let index = 1; (index * 100 + 50) / 1000 <= to; index++) {
        const t = (index * 100 + 50) / 1000;
        points.push({ t, value : lagAt(t) });
    }
    return points;
}

describe("epochAverages", () => {
    // Three blocks of 500 ms, at 10 s, 20 s and 30 s. The window that contains each block ends 0.55 s after its start.
    const starts = [10, 20, 30];
    const peakAt = (t : number) : boolean => starts.some(start => Math.abs(t - (start + 0.55)) < 1e-6);
    const model = testModel({
        now : 40,
        drift : driftSeries(40, t => (peakAt(t) ? 500 : 1)),
        frames : starts.map(start => frame(start, 520, 470)),
        interactions : starts.map((start, index) => interaction(index + 1, start - 0.01, 540)),
    });
    const episodes = blockEpisodes(model);

    it("averages each signal in its bin", () => {
        const result = epochAverages(model, episodes);
        expect(result.used).toBe(3);
        expect(result.bins).toHaveLength(60);
        const at = (offset : number) => result.bins.find(bin => Math.abs(bin.offset - offset) < 1e-9)!;
        // The drift window that contains the block ends in the bin from 0.5 s to 0.6 s
        expect(at(0.5).drift).toMatchObject({ n : 3, mean : 500 });
        expect(at(0.5).drift!.upper).toBeCloseTo(500);
        expect(at(-1).drift).toMatchObject({ n : 3, mean : 1 });
        // The blocking of the frames is at 0 s. A bin without a frame has 0 ms, not "no value".
        expect(at(0).blocking).toMatchObject({ n : 3, mean : 470 });
        expect(at(1).blocking).toMatchObject({ n : 3, mean : 0 });
        // The interaction starts just before the block. A bin without an interaction has no value.
        expect(at(-0.1).event).toMatchObject({ n : 3, mean : 540 });
        expect(at(1).event).toBeUndefined();
    });

    it("aligns at the end of each block", () => {
        const result = epochAverages(model, episodes, { ...DEFAULT_EPOCH_OPTIONS, align : "end" });
        // The block ends at 0.52 s, and its drift window ends at 0.55 s: 0.03 s after the end
        const bin = result.bins.find(candidate => Math.abs(candidate.offset) < 1e-9)!;
        expect(bin.drift).toMatchObject({ n : 3, mean : 500 });
    });

    it("gives no value for the bins outside the recorded time", () => {
        const early = testModel({ now : 11, drift : driftSeries(11, () => 1), frames : [frame(0.5, 300, 250)] });
        const result = epochAverages(early, blockEpisodes(early));
        expect(result.bins[0]!.blocking).toBeUndefined();
        expect(result.bins.find(bin => Math.abs(bin.offset) < 1e-9)!.blocking).toMatchObject({ n : 1, mean : 250 });
    });

    it("gives no blocking value in a browser without long animation frames", () => {
        const result = epochAverages({ ...model, support : { ...model.support, longAnimationFrame : false } }, episodes);
        expect(result.bins.every(bin => bin.blocking === undefined)).toBe(true);
    });

    it("counts no epoch whose window is completely outside the recorded time", () => {
        const result = epochAverages({ ...model, now : 5 }, episodes);
        expect(result.used).toBe(0);
        expect(result.bins.every(bin => bin.drift === undefined)).toBe(true);
    });
});

describe("reportedLagIn", () => {
    // Windows to 1 s, a window of 600 ms of lag that ends at 1.7 s, then nothing until a window that ends at 10 s
    const points = [...driftSeries(1, () => 1).filter(point => point.t <= 0.95), { t : 1.05, value : 1 }, { t : 1.75, value : 600 }, { t : 1.85, value : 2 }, { t : 10, value : 1 }];

    it("sums the lag of the windows that end in the bin", () => {
        expect(reportedLagIn(points, 1.7, 1.9)).toBe(602);
    });

    it("gives 0 ms in a long window, where the monitor reports nothing yet", () => {
        expect(reportedLagIn(points, 1.2, 1.3)).toBe(0);
    });

    it("gives no value where no window covers the bin", () => {
        // The window that ends at 10 s starts at 9.9 s: before it, the series has a gap (for example a hidden page)
        expect(reportedLagIn(points, 5, 5.1)).toBeUndefined();
        expect(reportedLagIn(points, 11, 11.1)).toBeUndefined();
    });
});
