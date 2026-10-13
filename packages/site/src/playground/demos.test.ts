import { describe, expect, it } from "vitest";
import { demoSupported, METRIC_DEFINITIONS, type DemoFocus } from "../adapters/lag-core";
import { LOAD_ACTION_IDS, PROFILE_IDS } from "../adapters/lag-load";
import { supportSummary } from "../components/LiveDemo/support";
import { DEMOS, demoFocusOf, demoMetricNames } from "./demos";

const FOCI = Object.keys(DEMOS) as DemoFocus[];

describe("DEMOS", () => {
    it("has one demo for each page, with metrics of the catalog and loads of the playground", () => {
        for (const focus of FOCI) {
            const demo = DEMOS[focus];
            expect(demo.focus).toBe(focus);
            for (const key of [...(demo.chart ? [demo.chart.metric] : []), ...demo.values.map(value => value.metric)]) {
                expect(METRIC_DEFINITIONS[key], `${focus}: ${key}`).toBeDefined();
            }
            for (const load of demo.loads) {
                if (load.kind === "action") expect(LOAD_ACTION_IDS).toContain(load.id);
                if (load.kind === "profile") expect(PROFILE_IDS).toContain(load.id);
            }
            // The monitor of the demo emits the metrics that it shows
            for (const value of demo.values) expect(METRIC_DEFINITIONS[value.metric].monitor).toBe(demo.monitor);
        }
    });

    it("names a feature of the browser support page for each demo that needs an API", () => {
        for (const focus of FOCI) {
            const feature = DEMOS[focus].feature;
            if (feature) expect(supportSummary(feature), focus).toBeDefined();
        }
    });
});

describe("demoFocusOf", () => {
    it("gives the monitor of a demo session, and nothing for the other kinds", () => {
        expect(demoFocusOf("demo:drift-lag")).toBe("drift-lag");
        expect(demoFocusOf("full")).toBeUndefined();
        expect(demoFocusOf("home")).toBeUndefined();
        expect(demoFocusOf("demo:toString" as "demo:drift-lag")).toBeUndefined();
    });
});

describe("demoMetricNames", () => {
    it("gives each instrument of the demo one time", () => {
        expect(demoMetricNames("drift-lag")).toEqual(["lag_drift_histogram", "lag_drift_baseline_histogram"]);
        expect(demoMetricNames("lifecycle")).toEqual(["lag_lifecycle_transitions"]);
    });
});

describe("supportSummary", () => {
    it("gives the browsers of a feature from the browser support page", () => {
        expect(supportSummary("Long Animation Frames")).toBe("Chrome and Edge 123 and later. Firefox: no. Safari: no.");
        expect(supportSummary("No such feature")).toBeUndefined();
    });
});

describe("demoSupported", () => {
    it("needs the entry type of an observer demo", () => {
        const chromium = { PerformanceObserver : { supportedEntryTypes : ["event", "layout-shift", "long-animation-frame"] } };
        const firefox = { PerformanceObserver : { supportedEntryTypes : ["event"] } };
        expect(demoSupported("long-animation-frames", chromium)).toBe(true);
        expect(demoSupported("long-animation-frames", firefox)).toBe(false);
        expect(demoSupported("event-timing", firefox)).toBe(true);
        expect(demoSupported("layout-shift", {})).toBe(false);
    });

    it("needs the API of each other demo, and nothing for the timer demos", () => {
        expect(demoSupported("drift-lag", {})).toBe(true);
        expect(demoSupported("lifecycle", {})).toBe(true);
        expect(demoSupported("idle-availability", {})).toBe(false);
        expect(demoSupported("idle-availability", { requestIdleCallback : () => 0 })).toBe(true);
        expect(demoSupported("worker-lag", { Worker : class {} })).toBe(true);
        expect(demoSupported("memory", { performance : {} })).toBe(false);
        expect(demoSupported("memory", { performance : { memory : { usedJSHeapSize : 1 } } })).toBe(true);
        expect(demoSupported("gc-signal", { FinalizationRegistry })).toBe(true);
        expect(demoSupported("frame-timing", { requestAnimationFrame : () => 0 })).toBe(true);
    });
});
