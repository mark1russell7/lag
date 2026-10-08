import { describe, expect, it } from "vitest";
import { rateVital, type VitalName } from "./types.js";

describe("rateVital", () => {
    // These are the thresholds of web-vitals. A value at or below the first one is good. A value above the second one is poor.
    const cases : Array<[VitalName, number, number]> = [
        ["INP", 200, 500],
        ["CLS", 0.1, 0.25],
        ["LCP", 2_500, 4_000],
        ["FCP", 1_800, 3_000],
        ["TTFB", 800, 1_800],
    ];

    it.each(cases)("rates %s as good up to %s and as poor above %s, as web-vitals does", (name, good, poor) => {
        expect(rateVital(name, 0)).toBe("good");
        expect(rateVital(name, good)).toBe("good");
        expect(rateVital(name, (good + poor) / 2)).toBe("needs-improvement");
        expect(rateVital(name, poor)).toBe("needs-improvement");
        expect(rateVital(name, poor * 1.01)).toBe("poor");
    });
});
