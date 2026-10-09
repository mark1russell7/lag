import { describe, expect, it, vi } from "vitest";
import { EVENT_CATALOG, HISTOGRAM_BOUNDARIES, METRIC_CATALOG, METRICS, SPAN_CATALOG, createCounter, createHistogram, type MetricDefinition } from "./metric-catalog.js";
import type { InstrumentOptions, Meter } from "./meter.js";
import { VITAL_THRESHOLDS } from "./vitals/types.js";
import { createRecordingMeter } from "./test-utils.js";
import * as lag from "./index.js";
import type { DiscardReason, StallKind } from "./measurement-conditions.js";
import type { interactionType } from "./EventTimingMonitor.js";
import type { NavigationType } from "./vitals/types.js";
import type { MemoryMeasurement } from "./MemoryMonitor.js";
import type { PressureSource } from "./ComputePressureMonitor.js";
import type { LifecycleState, LifecycleTrigger } from "./LifecycleStateMachine.js";
import type { ClockJump } from "./ClockDriftMonitor.js";
import type { BrowserReportType } from "./BrowserReportMonitor.js";

/** The keys of a record, sorted. TypeScript makes sure that the record has each value of the union `T`, and no other value. */
const valuesOf = <T extends string>(values : Record<T, true>) : string[] => Object.keys(values).sort();
const sorted = (values : readonly string[] | undefined) : string[] => [...(values ?? [])].sort();

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

    it("gives the bucket boundaries of the catalog to the SDK as advice, as a copy", () => {
        const createHistogramSpy = vi.fn((_name : string, _options : InstrumentOptions) => ({ record() {} }));
        const createCounterSpy = vi.fn((_name : string, _options : InstrumentOptions) => ({ add() {} }));
        const meter : Meter = { createHistogram : createHistogramSpy, createCounter : createCounterSpy };

        createHistogram(meter, METRICS.vitalCls);
        createCounter(meter, METRICS.gcEvents);

        const options = createHistogramSpy.mock.calls[0]![1];
        expect(options).toEqual({
            unit : "1",
            description : METRICS.vitalCls.description,
            advice : { explicitBucketBoundaries : HISTOGRAM_BOUNDARIES.score },
        });
        expect(options.advice!.explicitBucketBoundaries).not.toBe(HISTOGRAM_BOUNDARIES.score);
        expect(createCounterSpy.mock.calls[0]![1]).toEqual({ unit : "{gc}", description : METRICS.gcEvents.description });

        // A histogram definition of the caller, without advice: the SDK uses its default buckets
        const { advice : _advice, ...withoutAdvice } = METRICS.drift;
        createHistogram(meter, withoutAdvice);
        expect(createHistogramSpy.mock.calls[1]![1]).toEqual({ unit : "ms", description : METRICS.drift.description });
    });

    it("refuses to create an instrument of the wrong kind", () => {
        const recording = createRecordingMeter();
        expect(() => createCounter(recording.meter, METRICS.drift)).toThrow("lag_drift_histogram is a histogram, not a counter.");
        expect(() => createHistogram(recording.meter, METRICS.gcEvents)).toThrow();
    });

    it("permits exactly the values of the types of the monitors as attribute values", () => {
        const stallKinds = valuesOf<StallKind>({ hang : true, suspend : true });
        const interactions = valuesOf<ReturnType<typeof interactionType>>({ pointer : true, keyboard : true, other : true });
        const navigationTypes = valuesOf<NavigationType>({
            "navigate" : true,
            "reload" : true,
            "back-forward" : true,
            "back-forward-cache" : true,
            "prerender" : true,
            "restore" : true,
            "soft-navigation" : true,
        });
        const states = valuesOf<LifecycleState>({ active : true, passive : true, hidden : true, frozen : true, terminated : true });

        expect(sorted(METRICS.samplesDiscarded.attributes["reason"])).toEqual(valuesOf<DiscardReason>({ hidden : true, frozen : true, suspend : true }));
        expect(sorted(METRICS.stalls.attributes["kind"])).toEqual(stallKinds);
        expect(sorted(METRICS.stallDuration.attributes["kind"])).toEqual(stallKinds);
        for (const definition of [METRICS.eventDuration, METRICS.eventInputDelay, METRICS.eventProcessing, METRICS.eventPresentationDelay]) {
            expect(sorted(definition.attributes["interaction"]), definition.name).toEqual(interactions);
        }
        for (const definition of [METRICS.vitalInp, METRICS.vitalCls, METRICS.vitalLcp, METRICS.vitalFcp, METRICS.vitalTtfb]) {
            expect(sorted(definition.attributes["navigation_type"]), definition.name).toEqual(navigationTypes);
        }
        expect(sorted(METRICS.memoryUsed.attributes["source"])).toEqual(valuesOf<MemoryMeasurement["source"]>({ modern : true, legacy : true }));
        expect(sorted(METRICS.pressureState.attributes["source"])).toEqual(valuesOf<PressureSource>({ cpu : true, thermals : true, power : true, memory : true }));
        expect(sorted(METRICS.lifecycleTransitions.attributes["from"])).toEqual(states);
        expect(sorted(METRICS.lifecycleTransitions.attributes["to"])).toEqual(states);
        expect(sorted(METRICS.lifecycleTransitions.attributes["trigger"])).toEqual(valuesOf<LifecycleTrigger>({
            focus : true,
            blur : true,
            visibilitychange : true,
            freeze : true,
            resume : true,
            pagehide : true,
            pageshow : true,
        }));
        expect(sorted(METRICS.clockJumps.attributes["direction"])).toEqual(valuesOf<ClockJump["direction"]>({ forward : true, backward : true }));
        expect(sorted(METRICS.clockJumps.attributes["kind"])).toEqual(valuesOf<ClockJump["kind"]>({ suspend : true, step : true }));
        expect(sorted(METRICS.browserReports.attributes["type"])).toEqual(valuesOf<BrowserReportType>({ intervention : true, deprecation : true }));
    });

    it("names a monitor of the package for each metric and each event", () => {
        const exported = new Set(Object.keys(lag));
        const known = (monitor : string) => exported.has(monitor) || exported.has(`create${monitor}`);

        for (const m of METRIC_CATALOG) expect(known(m.monitor), `${m.name}: ${m.monitor}`).toBe(true);
        for (const e of EVENT_CATALOG) expect(known(e.monitor), `${e.name}: ${e.monitor}`).toBe(true);
    });

    it("gives every event a description", () => {
        for (const e of EVENT_CATALOG) expect(e.description.length, e.name).toBeGreaterThan(10);
    });

    it("has unique span names with the lag. prefix, attributes, a description and a monitor of the package", () => {
        const names = SPAN_CATALOG.map(s => s.name);
        expect(new Set(names).size).toBe(names.length);
        const exported = new Set(Object.keys(lag));
        for (const s of SPAN_CATALOG) {
            expect(s.name, s.name).toMatch(/^lag\.[a-z_.]+$/);
            expect(s.attributes.length, s.name).toBeGreaterThan(0);
            expect(s.description.length, s.name).toBeGreaterThan(10);
            expect(exported.has(s.monitor) || exported.has(`create${s.monitor}`), `${s.name}: ${s.monitor}`).toBe(true);
        }
    });
});

/** The bucket of `value`, as the SDK finds it: the first boundary that is equal to or more than the value. */
function bucketOf(boundaries : readonly number[], value : number) : number {
    const index = boundaries.findIndex(boundary => value <= boundary);
    return index < 0 ? boundaries.length : index;
}

const boundariesOf = (definition : MetricDefinition) : readonly number[] => definition.advice?.explicitBucketBoundaries ?? [];

/** The number of different buckets of the values. */
const bucketCount = (definition : MetricDefinition, values : readonly number[]) : number =>
    new Set(values.map(value => bucketOf(boundariesOf(definition), value))).size;

describe("histogram buckets", () => {
    it("gives each histogram ascending, unique bucket boundaries, and no counter", () => {
        for (const m of METRIC_CATALOG) {
            if (m.kind === "counter") {
                expect(m.advice, m.name).toBeUndefined();
                continue;
            }
            const boundaries = boundariesOf(m);
            expect(boundaries.length, m.name).toBeGreaterThanOrEqual(4);
            expect([...boundaries].sort((a, b) => a - b), m.name).toEqual(boundaries);
            expect(new Set(boundaries).size, m.name).toBe(boundaries.length);
        }
    });

    it("selects the boundaries from the unit, and the ordinal boundaries for the pressure state", () => {
        for (const m of METRIC_CATALOG.filter(definition => definition.kind === "histogram")) {
            const expected = m === METRICS.pressureState ? HISTOGRAM_BOUNDARIES.ordinal
                : m.unit === "ms" ? HISTOGRAM_BOUNDARIES.duration
                : m.unit === "By" ? HISTOGRAM_BOUNDARIES.bytes
                : HISTOGRAM_BOUNDARIES.score;
            expect(boundariesOf(m), m.name).toBe(expected);
        }
    });

    it("makes the thresholds of the Web Vitals bucket boundaries, thus the buckets give the exact ratings", () => {
        const definitions = { INP : METRICS.vitalInp, CLS : METRICS.vitalCls, LCP : METRICS.vitalLcp, FCP : METRICS.vitalFcp, TTFB : METRICS.vitalTtfb };
        for (const [name, definition] of Object.entries(definitions)) {
            const { good, poor } = VITAL_THRESHOLDS[name as keyof typeof definitions];
            expect(boundariesOf(definition), name).toContain(good);
            expect(boundariesOf(definition), name).toContain(poor);
        }
    });

    it("puts the typical values of each type of histogram into different buckets", () => {
        // CLS: good, at the good threshold, needs improvement, poor
        expect(bucketCount(METRICS.vitalCls, [0.05, 0.1, 0.2, 0.3])).toBe(4);
        expect(bucketCount(METRICS.layoutShift, [0.001, 0.005, 0.05, 0.2])).toBe(4);
        expect(bucketCount(METRICS.memoryUsage, [0.3, 0.6, 0.8, 0.95])).toBe(4);
        expect(bucketCount(METRICS.pressureState, [0, 1, 2, 3])).toBe(4);
        expect(bucketCount(METRICS.memoryUsed, [16, 64, 256, 1_024, 4_096].map(mib => mib * 2 ** 20 * 0.9))).toBe(5);
        // The clock resolutions: cross-origin isolated Chrome and Firefox, Chrome, Firefox and Safari
        expect(bucketCount(METRICS.clockResolution, [0.005, 0.02, 0.1, 1])).toBe(4);
        // Frame deltas at 120 Hz, 60 Hz and 30 Hz
        expect(bucketCount(METRICS.frameDelta, [8.3, 16.7, 33.4])).toBe(3);
        expect(bucketCount(METRICS.drift, [3, 30, 60, 120, 600, 6_000, 40_000])).toBe(7);
    });

    it("gives exactly the documented boundaries", () => {
        expect(HISTOGRAM_BOUNDARIES.ordinal).toEqual([0, 1, 2, 3]);
        expect(HISTOGRAM_BOUNDARIES.score).toEqual([0, 0.001, 0.01, 0.025, 0.05, 0.1, 0.15, 0.25, 0.5, 0.75, 0.9, 1]);
        expect(HISTOGRAM_BOUNDARIES.bytes[0]).toBe(2 ** 20);
        expect(HISTOGRAM_BOUNDARIES.bytes.at(-1)).toBe(2 ** 34);
        expect(HISTOGRAM_BOUNDARIES.bytes.every(value => Number.isInteger(Math.log2(value)))).toBe(true);
        expect(HISTOGRAM_BOUNDARIES.duration).toEqual(expect.arrayContaining([0, 16, 33, 50, 100, 5_000, 60_000]));
    });
});
