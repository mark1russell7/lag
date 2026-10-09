import { expect } from "vitest";
import {
    ComputePressureMonitor,
    IdleAvailabilityMonitor,
    LayoutShiftMonitor,
    MemoryMonitor,
    createPageSource,
    type IdleMeasurement,
    type LayoutShiftReport,
    type PressureMeasurement,
    type PressureObserverInit,
} from "@mark1russell7/lag";
import { createRecordingLogger, nextFrames, wait, waitUntil } from "./harness.js";
import { features } from "./features.js";
import { recordMeasurement } from "./commands.js";

/**
 * The monitors of the APIs that only some engines have. Each test skips
 * itself, with the reason, where the browser does not have its API.
 */
describe("Monitors of engine-specific APIs", () => {
    it("LayoutShiftMonitor records each layout shift that the browser reports", async (ctx) => {
        ctx.skip(!features.layoutShift.supported, features.layoutShift.reason);
        const raw : number[] = [];
        const observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) {
                const shift = entry as PerformanceEntry & { value : number; hadRecentInput : boolean };
                if (!shift.hadRecentInput) raw.push(shift.value);
            }
        });
        observer.observe({ type : "layout-shift", buffered : true });
        const reports : LayoutShiftReport[] = [];
        const monitor = new LayoutShiftMonitor((report) => reports.push(report), createRecordingLogger(), PerformanceObserver);
        try {
            const text = document.createElement("p");
            text.textContent = "This paragraph moves down.";
            text.style.cssText = "font-size: 28px; margin: 0;";
            document.body.append(text);
            await nextFrames(3);
            const block = document.createElement("div");
            block.style.cssText = "height: 150px; width: 300px;";
            document.body.insertBefore(block, text);
            await nextFrames(3);

            expect(await waitUntil(() => raw.length > 0 && reports.length === raw.length, 3_000)).toBe(true);
            expect(reports.map(r => r.value)).toEqual(raw);
            expect(monitor.getCLS()).toBeCloseTo(raw.reduce((a, b) => a + b, 0), 12);
            await recordMeasurement("browser-apis/layout-shift/lag_layout_shift_histogram", "1", raw);
        } finally {
            monitor.stop();
            observer.disconnect();
        }
    });

    it("ComputePressureMonitor observes the real CPU pressure source", async (ctx) => {
        ctx.skip(!features.computePressure.supported, features.computePressure.reason);
        const logger = createRecordingLogger();
        const measurements : PressureMeasurement[] = [];
        const PressureObserver = (globalThis as unknown as { PressureObserver : PressureObserverInit }).PressureObserver;
        const monitor = new ComputePressureMonitor(["cpu"], (m) => measurements.push(m), logger, PressureObserver, 500);
        try {
            await waitUntil(() => measurements.length > 0 || logger.messages.length > 0, 2_000);
            console.log(`Compute pressure: ${JSON.stringify(measurements.slice(0, 3))}, warnings: ${JSON.stringify(logger.messages)}`);
            // Chromium sends records only to a page that passes its privacy test (focused and visible),
            // and only when the state changes. A headless run can get no record in this time, thus the
            // test checks the records that come; the cdp project drives a virtual source to known states.
            for (const message of logger.messages) expect(message.message).toMatch(/PressureObserver/);
            for (const m of measurements) {
                expect(m.source).toBe("cpu");
                expect([0, 1, 2, 3]).toContain(m.stateOrdinal);
            }
        } finally {
            monitor.stop();
        }
    });

    it("the page source reads the visibility-state entries", (ctx) => {
        ctx.skip(!features.visibilityState.supported, features.visibilityState.reason);
        // There is always an entry for the initial state, at time 0
        const entries = performance.getEntriesByType("visibility-state");
        expect(entries[0]).toMatchObject({ name : "visible", startTime : 0 });
        // The page was never hidden: no first hidden time for the vitals
        expect(createPageSource(document, performance).hiddenTimes()).toEqual([]);
    });

    it("the browser has the Page Lifecycle freeze and resume events", (ctx) => {
        ctx.skip(!features.freezeEvent.supported, features.freezeEvent.reason);
        // The cdp project freezes a real page; here only the API surface
        const lifecycleDocument = document as Document & { onfreeze? : unknown; onresume? : unknown; wasDiscarded? : boolean };
        expect(lifecycleDocument.onfreeze).toBeNull();
        expect(lifecycleDocument.onresume).toBeNull();
        expect(lifecycleDocument.wasDiscarded).toBe(false);
    });

    it("IdleAvailabilityMonitor sees the idle periods of an idle page", async (ctx) => {
        ctx.skip(!features.requestIdleCallback.supported, features.requestIdleCallback.reason);
        const measurements : IdleMeasurement[] = [];
        const monitor = new IdleAvailabilityMonitor(
            (m) => measurements.push(m),
            createRecordingLogger(),
            (callback, options) => requestIdleCallback(callback, options),
            (id) => cancelIdleCallback(id),
            performance,
        );
        try {
            await wait(1_000);
            expect(measurements.length).toBeGreaterThan(0);
            // The deadline of an idle period is at most 50 ms (the spec cap)
            for (const m of measurements) expect(m.timeRemainingMs).toBeLessThanOrEqual(50);
            await recordMeasurement("browser-apis/idle/lag_idle_time_remaining_histogram", "ms", measurements.map(m => m.timeRemainingMs));
        } finally {
            monitor.stop();
        }
    });

    it("MemoryMonitor reads performance.memory", async (ctx) => {
        ctx.skip(!features.performanceMemory.supported, features.performanceMemory.reason);
        const samples : number[] = [];
        const monitor = new MemoryMonitor(
            60_000,
            { readLegacy : () => (performance as Performance & { memory : { usedJSHeapSize : number; totalJSHeapSize : number; jsHeapSizeLimit : number } }).memory },
            (m) => samples.push(m.usedBytes),
            createRecordingLogger(),
            (fn, ms) => window.setInterval(fn, ms),
            (id) => window.clearInterval(id),
            performance,
        );
        try {
            // The first sample is immediate
            await waitUntil(() => samples.length > 0, 1_000);
            expect(samples[0]).toBeGreaterThan(1_000_000);
        } finally {
            monitor.stop();
        }
    });
});
