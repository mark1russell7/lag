import { describe, it, expect, vi, afterEach } from "vitest";
import { createBrowserDeps, type BrowserGlobals } from "./browser-deps.js";
import { setupAllMonitors } from "../setup-all-monitors.js";
import { createRecordingMeter } from "../test-utils.js";
import { createFakeEventTarget, createFakePerformanceObserver } from "../vitals/test-fakes.js";
import type { WorkerLike } from "../WorkerLagMonitor.js";

/** Browser globals whose functions throw without their `this` value, as some browser functions do. */
function createGlobals(extra : Record<string, unknown> = {}) {
    const windowTarget = createFakeEventTarget();
    const document = Object.assign(createFakeEventTarget(), { visibilityState : "visible", hasFocus : () => true });
    const strict = <T>(owner : () => object, fn : (...args : never[]) => T) => function (this : unknown, ...args : never[]) {
        if (this !== owner()) throw new TypeError("Illegal invocation");
        return fn(...args);
    };
    const performance : { timeOrigin : number; now() : number; getEntriesByType() : [] } = {
        timeOrigin : 1_700_000_000_000,
        now : strict(() => performance, () => Date.now()),
        getEntriesByType : () => [],
    };
    const globals : BrowserGlobals & Record<string, unknown> = {
        addEventListener : windowTarget.addEventListener,
        removeEventListener : windowTarget.removeEventListener,
        document,
        performance,
        setTimeout : (handler, timeout) => setTimeout(handler, timeout) as unknown as number,
        clearTimeout : (handle) => clearTimeout(handle),
        setInterval : (handler, timeout) => setInterval(handler, timeout) as unknown as number,
        clearInterval : (handle) => clearInterval(handle),
        requestAnimationFrame : strict(() => globals, (() => 1) as (...args : never[]) => number),
        cancelAnimationFrame : strict(() => globals, () => undefined),
        queueMicrotask : strict(() => globals, ((cb : () => void) => queueMicrotask(cb)) as (...args : never[]) => void),
        PerformanceObserver : createFakePerformanceObserver(["event", "paint"]).PerformanceObserver,
        ...extra,
    };
    return globals;
}

const options = () => ({ logger : { log : vi.fn() }, meter : createRecordingMeter().meter });

describe("createBrowserDeps", () => {
    afterEach(() => vi.useRealTimers());

    it("binds each browser function to its object", () => {
        const deps = createBrowserDeps(createGlobals(), options());

        expect(() => deps.clock.now()).not.toThrow();
        expect(() => deps.requestAnimationFrame!(() => {})).not.toThrow();
        expect(() => deps.queueMicrotask?.(() => {})).not.toThrow();
    });

    it("leaves out the deps of an API that the browser does not have", () => {
        // As in Safari: no requestIdleCallback, no ReportingObserver, no PressureObserver
        const deps = createBrowserDeps(createGlobals(), options());

        expect(deps.requestIdleCallback).toBeUndefined();
        expect(deps.cancelIdleCallback).toBeUndefined();
        expect(deps.ReportingObserver).toBeUndefined();
        expect(deps.PressureObserver).toBeUndefined();
        expect(deps.memorySource).toBeUndefined();
        // MessageChannel is missing, so the scheduling monitor cannot use queueMicrotask alone
        expect(deps.queueMicrotask).toBeUndefined();
    });

    it("uses shared memory only in a cross-origin-isolated page, and only if the option permits it", () => {
        const isolated = createGlobals({ SharedArrayBuffer, crossOriginIsolated : true });
        expect(createBrowserDeps(isolated, options()).SharedArrayBuffer).toBe(SharedArrayBuffer);
        expect(createBrowserDeps(isolated, { ...options(), sharedMemory : false }).SharedArrayBuffer).toBeUndefined();
        expect(createBrowserDeps(createGlobals({ SharedArrayBuffer, crossOriginIsolated : false }), options()).SharedArrayBuffer).toBeUndefined();
    });

    it("finds the legacy and the standard memory APIs", async () => {
        const globals = createGlobals();
        const memory = { usedJSHeapSize : 1, totalJSHeapSize : 2, jsHeapSizeLimit : 3 };
        const result = { bytes : 42, breakdown : [] };
        Object.assign(globals.performance, {
            memory,
            measureUserAgentSpecificMemory() {
                if (this !== globals.performance) throw new TypeError("Illegal invocation");
                return Promise.resolve(result);
            },
        });
        const deps = createBrowserDeps(globals, options());

        expect(deps.memorySource!.readLegacy!()).toBe(memory);
        await expect(deps.memorySource!.measureModern!()).resolves.toBe(result);
    });

    it("observes the cpu pressure source by default", () => {
        class PressureObserver {}
        expect(createBrowserDeps(createGlobals({ PressureObserver }), options()).pressureSources).toEqual(["cpu"]);
        expect(createBrowserDeps(createGlobals({ PressureObserver }), { ...options(), pressureSources : ["thermals"] }).pressureSources).toEqual(["thermals"]);
    });

    it("passes the options through", () => {
        const worker : WorkerLike = { postMessage : vi.fn(), addEventListener : vi.fn(), removeEventListener : vi.fn() };
        const events = { emit : vi.fn() };
        const deps = createBrowserDeps(createGlobals(), {
            ...options(),
            events,
            worker,
            workerHeartbeatIntervalMs : 100,
            workerHangReport : { url : "https://otel.example/v1/logs" },
            memoryIntervalMs : 5_000,
            softNavigations : true,
        });

        expect(deps).toMatchObject({
            events,
            worker,
            workerHeartbeatIntervalMs : 100,
            workerHangReport : { url : "https://otel.example/v1/logs" },
            memoryIntervalMs : 5_000,
            softNavigations : true,
        });
    });

    it("uses IndexedDB for the hang journal only with a worker, and only if the option permits it", () => {
        const worker : WorkerLike = { postMessage : vi.fn(), addEventListener : vi.fn(), removeEventListener : vi.fn() };
        const indexedDB = { open : vi.fn() };
        const globals = createGlobals({ indexedDB });

        expect(createBrowserDeps(globals, { ...options(), worker }).hangJournal).toBeDefined();
        expect(createBrowserDeps(globals, options()).hangJournal).toBeUndefined();
        expect(createBrowserDeps(globals, { ...options(), worker, hangJournal : false }).hangJournal).toBeUndefined();
        expect(createBrowserDeps(createGlobals(), { ...options(), worker }).hangJournal).toBeUndefined();
        // The database opens only at the first operation
        expect(indexedDB.open).not.toHaveBeenCalled();
    });

    it("uses the crash-report context of the browser where it exists", () => {
        const crashReport = { initialize : vi.fn(), set : vi.fn(), delete : vi.fn() };
        expect(createBrowserDeps(createGlobals({ crashReport }), options()).crashReport).toBe(crashReport);
        expect(createBrowserDeps(createGlobals({ crashReport }), { ...options(), crashReportContext : false }).crashReport).toBeUndefined();
        expect(createBrowserDeps(createGlobals(), options()).crashReport).toBeUndefined();
    });

    it("gives setupAllMonitors the monitors that the browser can support", () => {
        vi.useFakeTimers();
        const handles = setupAllMonitors(createBrowserDeps(createGlobals(), options()));
        const names = handles.registry.getAll().map(h => h.name);

        expect(names).toContain("page-view-vitals");
        expect(names).toContain("frame-timing");
        expect(names).not.toContain("idle-availability");
        expect(names).not.toContain("scheduling-fairness");
        handles.stop();
        expect(vi.getTimerCount()).toBe(0);
    });
});
