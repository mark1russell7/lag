import { describe, expect, it } from "vitest";
import { EVENT_CATALOG, METRIC_CATALOG, METRICS, createCounter, createHistogram } from "./metric-catalog.js";
import { createRecordingMeter } from "./test-utils.js";

describe("metric catalog", () => {
    it("has unique metric names", () => {
        const names = METRIC_CATALOG.map(m => m.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it("uses the naming rules: lag_ prefix; histograms end in _histogram, counters do not", () => {
        for (const m of METRIC_CATALOG) {
            expect(m.name, m.name).toMatch(/^lag_[a-z0-9_]+$/);
            expect(m.name.endsWith("_histogram"), m.name).toBe(m.kind === "histogram");
        }
    });

    it("gives every metric a description, a unit and a closed set of attribute values", () => {
        for (const m of METRIC_CATALOG) {
            expect(m.description.length, m.name).toBeGreaterThan(10);
            expect(m.unit.length, m.name).toBeGreaterThan(0);
            for (const [key, values] of Object.entries(m.attributes)) {
                expect(values.length, `${m.name}.${key}`).toBeGreaterThan(0);
                expect(new Set(values).size, `${m.name}.${key}`).toBe(values.length);
            }
        }
    });

    it("has unique event names with attributes", () => {
        const names = EVENT_CATALOG.map(e => e.name);
        expect(new Set(names).size).toBe(names.length);
        for (const e of EVENT_CATALOG) expect(e.attributes.length, e.name).toBeGreaterThan(0);
    });

    it("creates instruments of the declared kind and unit", () => {
        const recording = createRecordingMeter();
        createHistogram(recording.meter, METRICS.drift).record(1);
        createCounter(recording.meter, METRICS.gcEvents).add(1);

        expect(recording.instruments().map(i => [i.name, i.kind, i.unit])).toEqual([
            ["lag_drift_histogram", "histogram", "ms"],
            ["lag_gc_events", "counter", "{gc}"],
        ]);
    });

    it("refuses to create an instrument of the wrong kind", () => {
        const recording = createRecordingMeter();
        expect(() => createCounter(recording.meter, METRICS.drift)).toThrow("lag_drift_histogram is a histogram, not a counter.");
        expect(() => createHistogram(recording.meter, METRICS.gcEvents)).toThrow();
    });
});
