import { vi, expect } from "vitest";
import { LongAnimationFrameMonitor } from "./LongAnimationFrameMonitor.js";
import type { PerformanceEntryList, PerformanceObserverInit, LoafEntry } from "./perf-types.js";
import { createFakePerformanceObserver } from "./vitals/test-fakes.js";

function createMockPerformanceObserver() {
    let capturedCallback : ((list : PerformanceEntryList) => void) | undefined;

    class MockPerformanceObserver {
        constructor(callback : (list : PerformanceEntryList) => void) {
            capturedCallback = callback;
        }
        observe() {}
        disconnect() {}
    }

    return {
        MockCtor : MockPerformanceObserver as unknown as PerformanceObserverInit,
        triggerEntries(entries : LoafEntry[]) {
            capturedCallback?.({ getEntries : () => entries });
        },
    };
}

function makeLoafEntry(overrides : Partial<LoafEntry> = {}) : LoafEntry {
    return {
        entryType : "long-animation-frame",
        name : "",
        startTime : 100,
        duration : 200,
        blockingDuration : 150,
        renderStart : 150,
        styleAndLayoutStart : 180,
        scripts : [],
        ...overrides,
    };
}

describe("LongAnimationFrameMonitor", () => {
    it("reports blockingDuration and duration from LoAF entries", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new LongAnimationFrameMonitor(report, logger, MockCtor);

        triggerEntries([makeLoafEntry({ blockingDuration : 120, duration : 250 })]);

        expect(report).toHaveBeenCalledTimes(1);
        expect(report).toHaveBeenCalledWith(expect.objectContaining({
            blockingDuration : 120,
            duration : 250,
        }));
    });

    it("calculates renderDuration from renderStart to the end of the frame", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new LongAnimationFrameMonitor(report, logger, MockCtor);

        // Frame ends at 100 + 200 = 300; rendering started at 220
        triggerEntries([makeLoafEntry({
            startTime : 100,
            duration : 200,
            renderStart : 220,
            styleAndLayoutStart : 250,
        })]);

        expect(report.mock.calls[0]![0].renderDuration).toBe(80);
    });

    it("reports renderDuration 0 for frames that did not render", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new LongAnimationFrameMonitor(report, logger, MockCtor);

        // Browsers report renderStart = styleAndLayoutStart = 0 when nothing rendered
        triggerEntries([makeLoafEntry({
            startTime : 5_000,
            duration : 120,
            renderStart : 0,
            styleAndLayoutStart : 0,
        })]);

        expect(report.mock.calls[0]![0].renderDuration).toBe(0);
    });

    it("detects forced layout from scripts", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new LongAnimationFrameMonitor(report, logger, MockCtor);

        triggerEntries([makeLoafEntry({
            scripts : [
                {
                    name : "script",
                    invoker : "onclick",
                    invokerType : "event-listener",
                    startTime : 100,
                    executionStart : 100,
                    duration : 50,
                    forcedStyleAndLayoutDuration : 10,
                    sourceURL : "app.js",
                },
            ],
        })]);

        expect(report.mock.calls[0]![0].hasForceLayout).toBe(true);
        expect(report.mock.calls[0]![0].scriptCount).toBe(1);
    });

    it("reports hasForceLayout=false when no forced layout", () => {
        const { MockCtor, triggerEntries } = createMockPerformanceObserver();
        const report = vi.fn();
        const logger = { log : vi.fn() };

        new LongAnimationFrameMonitor(report, logger, MockCtor);

        triggerEntries([makeLoafEntry({
            scripts : [
                {
                    name : "script",
                    invoker : "onclick",
                    invokerType : "event-listener",
                    startTime : 100,
                    executionStart : 100,
                    duration : 50,
                    forcedStyleAndLayoutDuration : 0,
                    sourceURL : "app.js",
                },
            ],
        })]);

        expect(report.mock.calls[0]![0].hasForceLayout).toBe(false);
    });

    describe("rules of the script attribution", () => {
        const script = (fields : { duration : number; forced? : number; functionName? : string; invoker? : string }) => ({
            name : "script",
            invoker : fields.invoker ?? "BUTTON.onclick",
            invokerType : "event-listener",
            startTime : 100,
            executionStart : 101,
            duration : fields.duration,
            forcedStyleAndLayoutDuration : fields.forced ?? 0,
            sourceURL : "https://shop.example/app.js",
            ...(fields.functionName === undefined ? {} : { sourceFunctionName : fields.functionName }),
        });

        it("reports no scripts for an entry without a list of scripts", () => {
            const { MockCtor, triggerEntries } = createMockPerformanceObserver();
            const report = vi.fn();
            new LongAnimationFrameMonitor(report, { log : vi.fn() }, MockCtor);
            const entry = makeLoafEntry();
            delete (entry as Partial<LoafEntry>).scripts;

            triggerEntries([entry]);

            expect(report).toHaveBeenCalledWith(expect.objectContaining({ scriptCount : 0, hasForceLayout : false, topScript : undefined }));
        });

        it("names the first of the longest scripts with its function name, and finds a forced layout in any script", () => {
            const { MockCtor, triggerEntries } = createMockPerformanceObserver();
            const report = vi.fn();
            new LongAnimationFrameMonitor(report, { log : vi.fn() }, MockCtor);

            triggerEntries([makeLoafEntry({ scripts : [
                script({ duration : 40, forced : 5, functionName : "onLoad", invoker : "IMG.onload" }),
                script({ duration : 120, functionName : "onClick", invoker : "BUTTON#buy.onclick" }),
                script({ duration : 120, functionName : "onSubmit", invoker : "FORM.onsubmit" }),
            ] })]);

            expect(report).toHaveBeenCalledWith(expect.objectContaining({
                scriptCount : 3,
                hasForceLayout : true,
                topScript : { invoker : "BUTTON#buy.onclick", invokerType : "event-listener", sourceURL : "https://shop.example/app.js", sourceFunctionName : "onClick", duration : 120 },
            }));
        });

        it("gives an empty function name for a script without one", () => {
            const { MockCtor, triggerEntries } = createMockPerformanceObserver();
            const report = vi.fn();
            new LongAnimationFrameMonitor(report, { log : vi.fn() }, MockCtor);

            triggerEntries([makeLoafEntry({ scripts : [script({ duration : 80 })] })]);

            expect(report.mock.calls[0]![0].topScript.sourceFunctionName).toBe("");
        });
    });

    it("reports each frame one time after stop() and start(): the restart does not read the buffer of the browser again", () => {
        const fake = createFakePerformanceObserver(["long-animation-frame"]);
        const report = vi.fn();
        fake.buffer("long-animation-frame", makeLoafEntry({ startTime : 100 }));
        const monitor = new LongAnimationFrameMonitor(report, { log : vi.fn() }, fake.PerformanceObserver);
        monitor.takeRecords();
        monitor.stop();
        // The browser keeps each frame in its buffer, also the frames during the stop
        fake.buffer("long-animation-frame", makeLoafEntry({ startTime : 500 }));
        monitor.start();
        monitor.takeRecords();
        fake.deliver("long-animation-frame", makeLoafEntry({ startTime : 900 }));

        expect(report.mock.calls.map(([frame]) => (frame as { startTime : number }).startTime)).toEqual([100, 900]);
    });

    it("reads the buffer at a restart when the stop came before the first delivery", () => {
        const fake = createFakePerformanceObserver(["long-animation-frame"]);
        const report = vi.fn();
        fake.buffer("long-animation-frame", makeLoafEntry({ startTime : 100 }));
        const monitor = new LongAnimationFrameMonitor(report, { log : vi.fn() }, fake.PerformanceObserver);
        monitor.stop();
        monitor.start();
        monitor.takeRecords();

        expect(report.mock.calls.map(([frame]) => (frame as { startTime : number }).startTime)).toEqual([100]);
    });
});
