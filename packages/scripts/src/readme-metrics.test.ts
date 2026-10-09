import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { METRIC_CATALOG } from "@mark1russell7/lag";
import { END_MARKER, START_MARKER, renderMetricTable, replaceBetweenMarkers } from "./readme-metrics.js";

describe("readme-metrics", () => {
    it("makes one row for each metric of the catalog", () => {
        const table = renderMetricTable(METRIC_CATALOG);
        expect(table.split("\n")).toHaveLength(METRIC_CATALOG.length + 2);
        expect(table).toContain("| DriftLag | `lag_drift_histogram` | histogram | `ms` |");
        expect(table).toContain("`outcome`");
    });

    it("escapes the pipe character in a description", () => {
        const table = renderMetricTable([{ name : "m", kind : "counter", unit : "1", monitor : "M", description : "a | b", attributes : {} }]);
        expect(table).toContain("a \\| b");
    });

    it("replaces only the text between the markers", () => {
        const text = `Before\n${START_MARKER}\nold\n${END_MARKER}\nAfter`;
        expect(replaceBetweenMarkers(text, "new")).toBe(`Before\n${START_MARKER}\nnew\n${END_MARKER}\nAfter`);
        expect(() => replaceBetweenMarkers("No markers", "new")).toThrow("must contain");
    });

    it("finds the README in agreement with the catalog", () => {
        const readme = readFileSync(new URL("../../../README.md", import.meta.url), "utf8");
        expect(replaceBetweenMarkers(readme, renderMetricTable(METRIC_CATALOG))).toBe(readme);
    });
});
