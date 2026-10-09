import * as Plot from "@observablehq/plot";
import { describe, expect, it } from "vitest";
import { summarize } from "../lib/stats";
import { readThemeColors } from "../theme/colors";
import { barInset, formatTick, measurementEcdf, measurementHistogram, runLabel, shortPath, symlogTicks } from "./charts";
import type { MeasurementGroup } from "./model/measurements";

describe("barInset", () => {
    it("keeps a bar at most 24 px thick", () => {
        // 2 bands in 1184 px with padding 0.3: each band is 360 px.
        expect(barInset(1248, 64, 2, 0.3)).toBeCloseTo((360.348 - 24) / 2, 1);
    });

    it("adds no inset when a band is already thin", () => {
        expect(barInset(300, 60, 20, 0.1)).toBe(0);
        expect(barInset(10, 64, 2)).toBe(0);
    });
});

describe("symlogTicks", () => {
    it("gives a 1-2-5 series up to the maximum", () => {
        expect(symlogTicks(431)).toEqual([0, 1, 2, 5, 10, 20, 50, 100, 200]);
        expect(symlogTicks(0.35)).toEqual([0, 0.1, 0.2]);
        expect(symlogTicks(0)).toEqual([0]);
    });
});

describe("measurement charts", () => {
    // The differences of performance.now() readings: almost equal values
    const values = [1000, 1500.1 - 500.1, 1000];
    const groups : MeasurementGroup[] = [
        { group : "chromium", values, sources : ["stress/idle"], summary : summarize(values) },
        { group : "firefox", values : [1, 5, 40], sources : ["stress/idle"], summary : summarize([1, 5, 40]) },
    ];
    const context = { width : 640, theme : readThemeColors(), Plot };

    it("build the histogram and the ECDF of almost equal values", () => {
        expect(() => measurementHistogram(groups, "ms")(context)).not.toThrow();
        expect(() => measurementEcdf(groups, "ms")(context)).not.toThrow();
    });

    it("give the ticks short labels, not the precision of a very small domain", () => {
        for (const builder of [measurementHistogram(groups, "ms"), measurementEcdf(groups, "ms")]) {
            const x = builder(context).x as { tickFormat? : (value : number) => string };
            expect(x.tickFormat?.(1000)).toBe("1,000");
            expect(x.tickFormat?.(0.002)).toBe("0.002");
        }
        expect(formatTick(999.9999999999999)).toBe("1,000");
        expect(formatTick(20_000)).toBe("20,000");
        expect(formatTick(0)).toBe("0");
    });
});

describe("labels", () => {
    it("formats a run date in UTC", () => {
        expect(runLabel("2026-10-06T09:41:33.000Z")).toBe("6 Oct, 09:41");
        expect(runLabel("not a date")).toBe("not a date");
    });

    it("keeps the last two parts of a path", () => {
        expect(shortPath("packages/lag/src/DriftLag.ts")).toBe("src/DriftLag.ts");
        expect(shortPath("a.ts")).toBe("a.ts");
    });
});
