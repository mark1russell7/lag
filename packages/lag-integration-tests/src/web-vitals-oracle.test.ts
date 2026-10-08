import { expect } from "vitest";
import { userEvent } from "vitest/browser";
import {
    onCLS,
    onFCP,
    onINP,
    onLCP,
    onTTFB,
    type INPMetricWithAttribution,
    type MetricWithAttribution,
} from "web-vitals/attribution";
import { createNoopMeter, setupAllMonitors, type AllMonitorHandles, type VitalName, type VitalValue } from "@lag/core";
import { blockMainThread, createBrowserDeps, createRecordingLogger, nextFrames, wait, waitUntil } from "./harness.js";
import { features } from "./features.js";
import { environment, recordMeasurement } from "./commands.js";

/**
 * The oracle: the real web-vitals library (v6) and the core PageViewVitals
 * observe the same page and the same performance entries. Both libraries
 * use the same rules, so the values must agree:
 * - INP: the longest interaction (one outlier for each 50 interactions).
 *   Both read the same Event Timing entries (durationThreshold 16), whose
 *   durations the browser rounds to 8 ms. Thus the values agree exactly.
 * - LCP, FCP, TTFB: the start time of the same entry minus activationStart
 *   (0 here). Exact.
 * - CLS (Chromium only): the worst session window of the same layout-shift
 *   entries, added in the same order. Exact.
 */

const oracle = new Map<VitalName, MetricWithAttribution>();
let handles : AllMonitorHandles;
const comparison : Record<string, { core? : number; webVitals? : number }> = {};

function core(name : VitalName) : VitalValue | undefined {
    return handles.vitals!.getValues().find(value => value.name === name);
}

async function compare(name : VitalName) : Promise<void> {
    const ours = core(name)?.value;
    const theirs = oracle.get(name)?.value;
    comparison[name] = {
        ...(ours !== undefined ? { core : ours } : {}),
        ...(theirs !== undefined ? { webVitals : theirs } : {}),
    };
    const unit = name === "CLS" ? "1" : "ms";
    if (ours !== undefined) await recordMeasurement(`oracle/core/${name}`, unit, [ours], { library : "core" });
    if (theirs !== undefined) await recordMeasurement(`oracle/web-vitals/${name}`, unit, [theirs], { library : "web-vitals" });
}

function slowButton(id : string, blockMs : number) : HTMLButtonElement {
    const button = document.createElement("button");
    button.id = id;
    button.textContent = `Blocks ${blockMs} ms`;
    button.addEventListener("click", () => blockMainThread(blockMs));
    document.body.append(button);
    return button;
}

describe("PageViewVitals agrees with web-vitals", () => {
    beforeAll(async () => {
        // Contentful text: the first contentful paint and the LCP candidate
        const heading = document.createElement("h1");
        heading.textContent = "The web-vitals oracle";
        document.body.append(heading);

        const options = { reportAllChanges : true };
        onINP((metric) => oracle.set("INP", metric), { ...options, durationThreshold : 16 });
        onCLS((metric) => oracle.set("CLS", metric), options);
        onLCP((metric) => oracle.set("LCP", metric), options);
        onFCP((metric) => oracle.set("FCP", metric), options);
        onTTFB((metric) => oracle.set("TTFB", metric), options);

        handles = setupAllMonitors(createBrowserDeps({ logger : createRecordingLogger(), meter : createNoopMeter() }));
        await nextFrames(3);
    });

    afterAll(() => {
        handles?.stop();
        console.log(`web-vitals oracle (${environment()}): ${JSON.stringify(comparison)}`);
    });

    it("FCP, LCP and TTFB agree exactly", async () => {
        const names : VitalName[] = ["FCP", "LCP", "TTFB"];
        const ready = await waitUntil(() => names.every(name => oracle.has(name) && core(name) !== undefined), 10_000);
        // The last LCP candidate can arrive after the first one
        await wait(500);
        for (const name of names) await compare(name);
        expect(ready, JSON.stringify(comparison)).toBe(true);
        for (const name of names) {
            expect(core(name)!.value, name).toBe(oracle.get(name)!.value);
        }
    });

    it("CLS agrees exactly", async (ctx) => {
        ctx.skip(!features.layoutShift.supported, features.layoutShift.reason);
        const block = document.createElement("div");
        block.style.cssText = "height: 120px; width: 300px; background: #999;";
        const text = document.createElement("p");
        text.style.cssText = "font-size: 32px; margin: 0;";
        text.textContent = "This text moves.";
        document.body.append(text);
        await nextFrames(3);

        // Two shifts in one session window, then one shift in a second window
        document.body.insertBefore(block, text);
        await nextFrames(3);
        block.style.height = "200px";
        await nextFrames(3);
        await wait(1_200);
        block.style.height = "60px";
        await nextFrames(3);

        await waitUntil(() => (oracle.get("CLS")?.value ?? 0) > 0 && (core("CLS")?.value ?? 0) > 0, 5_000);
        await wait(300);
        await compare("CLS");
        expect(core("CLS")!.value).toBeGreaterThan(0);
        expect(core("CLS")!.value).toBe(oracle.get("CLS")!.value);
    });

    // This test found a library bug: the core reported CLS = 0 where the
    // browser has no layout-shift entries, and web-vitals reports no CLS
    // there. Those zeros were false "good" values in lag_web_vital_cls_histogram.
    it("reports no CLS where the browser cannot measure it, as web-vitals does", async (ctx) => {
        ctx.skip(features.layoutShift.supported, "This browser measures layout shifts.");
        await waitUntil(() => core("FCP") !== undefined, 5_000);
        await compare("CLS");
        expect(oracle.has("CLS")).toBe(false);
        expect(core("CLS")).toBeUndefined();
    });

    it("INP agrees exactly, and so do its attribution phases", async (ctx) => {
        ctx.skip(!features.eventTiming.supported, features.eventTiming.reason);
        for (const blockMs of [40, 100, 180]) {
            await userEvent.click(slowButton(`slow-${blockMs}`, blockMs));
            await wait(300);
        }
        // web-vitals processes the entries in an idle callback (at most 1 s later)
        const agreed = await waitUntil(() => {
            const theirs = oracle.get("INP")?.value ?? 0;
            // Event Timing rounds a duration to the nearest 8 ms: a 180 ms handler can give 176 ms
            return theirs >= 176 && theirs === core("INP")?.value;
        }, 10_000);
        await compare("INP");

        const ours = core("INP")!;
        const theirs = oracle.get("INP") as INPMetricWithAttribution;
        const attribution = {
            core : {
                target : ours.attribution["interaction_target"],
                type : ours.attribution["interaction_type"],
                inputDelay : Number(ours.attribution["input_delay_ms"]),
                processingDuration : Number(ours.attribution["processing_duration_ms"]),
                presentationDelay : Number(ours.attribution["presentation_delay_ms"]),
            },
            webVitals : {
                target : theirs.attribution.interactionTarget,
                type : theirs.attribution.interactionType,
                inputDelay : theirs.attribution.inputDelay,
                processingDuration : theirs.attribution.processingDuration,
                presentationDelay : theirs.attribution.presentationDelay,
            },
        };
        console.log(`INP attribution (${environment()}): ${JSON.stringify(attribution)}`);

        expect(agreed, JSON.stringify(comparison)).toBe(true);
        expect(ours.value).toBe(theirs.value);
        expect(ours.value).toBeGreaterThanOrEqual(176);
        expect(attribution.core.target).toBe("#slow-180");
        expect(attribution.core.target).toBe(attribution.webVitals.target);
        expect(attribution.core.type).toBe(attribution.webVitals.type);
        // The phases of each library add up to INP
        const phases = (a : typeof attribution.core) : number => a.inputDelay + a.processingDuration + a.presentationDelay;
        expect(phases(attribution.core)).toBeCloseTo(ours.value, 6);
        expect(phases(attribution.webVitals)).toBeCloseTo(theirs.value, 6);
        // The 180 ms handler is in the processing phase of both
        expect(attribution.core.processingDuration).toBeGreaterThanOrEqual(175);
        expect(attribution.webVitals.processingDuration).toBeGreaterThanOrEqual(175);
        // Both libraries start the processing phase at the first event of the
        // frame, also an event of another interaction or a hover event of the
        // same click (interactionId 0). They read the same entries
        // (durationThreshold 16), thus the phases agree exactly.
        expect(attribution.core.inputDelay).toBeCloseTo(attribution.webVitals.inputDelay, 6);
        expect(attribution.core.processingDuration).toBeCloseTo(attribution.webVitals.processingDuration, 6);
        expect(attribution.core.presentationDelay).toBeCloseTo(attribution.webVitals.presentationDelay, 6);
    });
});
