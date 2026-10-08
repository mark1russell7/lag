import { describe, expect, it } from "vitest";
import { EVENT_CATALOG, METRIC_CATALOG, METRICS, createCounter, createHistogram } from "./metric-catalog.js";
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
});
