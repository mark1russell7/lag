import { describe, expect, it } from "vitest";
import { BLOCK_DURATIONS, epochRows } from "../../../content/docs/concepts/statistics.data";

describe("the simulated session of the documentation", () => {
    it("agrees with the text of the statistics page", () => {
        const meanDuration = BLOCK_DURATIONS.reduce((sum, value) => sum + value, 0) / BLOCK_DURATIONS.length;
        const atStart = epochRows.filter(row => row.alignment === "Time 0 at the block start");
        const atEnd = epochRows.filter(row => row.alignment === "Time 0 at the block end");
        // Aligned at the start, the lag spreads over the time from 0.2 s to 1 s
        const spread = atStart.filter(row => row.mean > 20).map(row => row.t);
        expect(Math.min(...spread)).toBeGreaterThanOrEqual(0.2);
        expect(Math.max(...spread)).toBeLessThanOrEqual(1);
        // Aligned at the end, the highest mean is at the time 0
        const peak = atEnd.reduce((best, row) => (row.mean > best.mean ? row : best));
        expect(Math.abs(peak.t)).toBeLessThan(0.1);
        // The sum of the bins is approximately the mean duration of the blocks (plus the jitter of the idle windows)
        const sum = atEnd.reduce((total, row) => total + row.mean, 0);
        expect(sum / meanDuration).toBeGreaterThan(1);
        expect(sum / meanDuration).toBeLessThan(1.1);
    });
});
