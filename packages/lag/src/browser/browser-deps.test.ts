import { describe, it, expect, vi, afterEach } from "vitest";
import { createBrowserDeps, type BrowserGlobals } from "./browser-deps.js";
import { setupAllMonitors } from "../setup-all-monitors.js";
import { createRecordingMeter } from "../test-utils.js";
import { createFakeEventTarget, createFakePerformanceObserver } from "../vitals/test-fakes.js";
import type { WorkerLike } from "../WorkerLagMonitor.js";
import { MemoryStorage } from "../test-peers.js";

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
        // A browser without requestIdleCallback, ReportingObserver and PressureObserver (Safari has a
        // ReportingObserver from 16.4, but without the intervention and deprecation reports)
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
        const pageContext = () => ({ "session.id" : "session-a" });
        const deps = createBrowserDeps(createGlobals(), {
            ...options(),
            events,
            worker,
            workerHeartbeatIntervalMs : 100,
            workerHangReport : { url : "https://otel.example/v1/logs" },
            memoryIntervalMs : 5_000,
            softNavigations : true,
            pageContext,
        });

        expect(deps).toMatchObject({
            events,
            worker,
            workerHeartbeatIntervalMs : 100,
            workerHangReport : { url : "https://otel.example/v1/logs" },
            memoryIntervalMs : 5_000,
            softNavigations : true,
            pageContext,
        });
    });

    it("uses IndexedDB for the hang journal only with a worker or the peer hang watch, and only if the option permits it", () => {
        const worker : WorkerLike = { postMessage : vi.fn(), addEventListener : vi.fn(), removeEventListener : vi.fn() };
        const indexedDB = { open : vi.fn() };
        const globals = createGlobals({ indexedDB });

        expect(createBrowserDeps(globals, { ...options(), worker }).hangJournal).toBeDefined();
        expect(createBrowserDeps(globals, options()).hangJournal).toBeUndefined();
        expect(createBrowserDeps(globals, { ...options(), worker, hangJournal : false }).hangJournal).toBeUndefined();
        expect(createBrowserDeps(createGlobals(), { ...options(), worker }).hangJournal).toBeUndefined();

        // Without a worker, the peer hang watch takes the record of a hung page from the journal
        const peerGlobals = createGlobals({
            indexedDB,
            BroadcastChannel : class { onmessage = null; postMessage() : void {} close() : void {} },
            navigator : { locks : { request : vi.fn() } },
        });
        expect(createBrowserDeps(peerGlobals, options()).hangJournal).toBeDefined();
        expect(createBrowserDeps(peerGlobals, { ...options(), peerHangWatch : false }).hangJournal).toBeUndefined();
        expect(createBrowserDeps(peerGlobals, { ...options(), hangJournal : false }).hangJournal).toBeUndefined();
        // The database opens only at the first operation
        expect(indexedDB.open).not.toHaveBeenCalled();
    });

    it("marks the reports of the peer hang watch in localStorage, with the conditions of the hang journal", () => {
        const worker : WorkerLike = { postMessage : vi.fn(), addEventListener : vi.fn(), removeEventListener : vi.fn() };
        const localStorage = new MemoryStorage();

        const marks = createBrowserDeps(createGlobals({ localStorage }), { ...options(), worker }).hangReportMarks;
        marks!.add("page", 5);
        expect(localStorage.getItem("lag-hang-reported:page")).toBe("5");

        expect(createBrowserDeps(createGlobals({ localStorage }), options()).hangReportMarks).toBeUndefined();
        expect(createBrowserDeps(createGlobals({ localStorage }), { ...options(), worker, hangJournal : false }).hangReportMarks).toBeUndefined();
        expect(createBrowserDeps(createGlobals({ localStorage : {} }), { ...options(), worker }).hangReportMarks).toBeUndefined();
        expect(createBrowserDeps(createGlobals(), { ...options(), worker }).hangReportMarks).toBeUndefined();
        // In a sandboxed frame, the read of localStorage throws
        const blocked = createGlobals();
        Object.defineProperty(blocked, "localStorage", { get : () => { throw new Error("SecurityError"); } });
        expect(createBrowserDeps(blocked, { ...options(), worker }).hangReportMarks).toBeUndefined();
    });

    it("uses BroadcastChannel and the Web Locks API for the peer hang watch, if the option permits it", async () => {
        class BroadcastChannel {
            onmessage = null;
            postMessage() : void {}
            close() : void {}
        }
        const request = vi.fn(function (this : unknown) {
            if (this !== locks) throw new TypeError("Illegal invocation");
            return Promise.resolve();
        });
        const locks = { request };
        const navigator = { locks };

        const deps = createBrowserDeps(createGlobals({ BroadcastChannel, navigator }), options());
        expect(deps.BroadcastChannel).toBe(BroadcastChannel);
        await deps.locks!.request("name", {}, () => {});
        expect(request).toHaveBeenCalledWith("name", {}, expect.any(Function));
        // AbortController cancels the waiting lock requests of the watch
        expect(deps.AbortController).toBeUndefined();
        expect(createBrowserDeps(createGlobals({ BroadcastChannel, navigator, AbortController }), options()).AbortController).toBe(AbortController);
        expect(createBrowserDeps(createGlobals({ navigator, AbortController }), options()).AbortController).toBeUndefined();

        expect(createBrowserDeps(createGlobals({ BroadcastChannel, navigator }), { ...options(), peerHangWatch : false }).locks).toBeUndefined();
        expect(createBrowserDeps(createGlobals({ navigator }), options()).locks).toBeUndefined();
        expect(createBrowserDeps(createGlobals({ BroadcastChannel }), options()).locks).toBeUndefined();
        expect(createBrowserDeps(createGlobals({ BroadcastChannel, navigator : {} }), options()).BroadcastChannel).toBeUndefined();
        expect(createBrowserDeps(createGlobals({ BroadcastChannel, navigator : { locks : {} } }), options()).BroadcastChannel).toBeUndefined();
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

    it("adapts the timer functions of the browser: each one passes the callback and the delay, and gives the handle of the browser", () => {
        const calls : unknown[] = [];
        const handler = () => {};
        const deps = createBrowserDeps(createGlobals({
            setTimeout : (callback : () => void, timeout : number) => { calls.push(["setTimeout", callback === handler, timeout]); return 11; },
            clearTimeout : (handle : number) => { calls.push(["clearTimeout", handle]); },
            setInterval : (callback : () => void, timeout : number) => { calls.push(["setInterval", callback === handler, timeout]); return 12; },
            clearInterval : (handle : number) => { calls.push(["clearInterval", handle]); },
        }), options());

        expect(deps.setTimeoutFn(handler, 5)).toBe(11);
        deps.clearTimeoutFn(11);
        expect(deps.setIntervalFn(handler, 1_000)).toBe(12);
        deps.clearIntervalFn(12);

        expect(calls).toEqual([["setTimeout", true, 5], ["clearTimeout", 11], ["setInterval", true, 1_000], ["clearInterval", 12]]);
    });

    it("leaves out PerformanceObserver when the browser does not have it", () => {
        expect(createBrowserDeps(createGlobals({ PerformanceObserver : undefined }), options()).PerformanceObserver).toBeUndefined();
    });

    it("reads the wall clock from Date.now()", () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_700_000_123_456);

        expect(createBrowserDeps(createGlobals(), options()).wallClock!.now()).toBe(1_700_000_123_456);
    });

    it("gives requestIdleCallback and cancelIdleCallback, bound to the window, only when the browser has both", () => {
        const globals = createGlobals();
        Object.assign(globals, {
            requestIdleCallback(this : unknown) {
                if (this !== globals) throw new TypeError("Illegal invocation");
                return 7;
            },
            cancelIdleCallback(this : unknown) {
                if (this !== globals) throw new TypeError("Illegal invocation");
            },
        });
        const deps = createBrowserDeps(globals, options());

        expect(deps.requestIdleCallback!(() => {})).toBe(7);
        expect(() => deps.cancelIdleCallback!(7)).not.toThrow();
        expect(createBrowserDeps(createGlobals({ requestIdleCallback : () => 7 }), options()).requestIdleCallback).toBeUndefined();
        expect(createBrowserDeps(createGlobals({ cancelIdleCallback : () => {} }), options()).cancelIdleCallback).toBeUndefined();
    });

    it("gives MessageChannel with queueMicrotask, and leaves out an API that is not a function", () => {
        class FakeChannel {}
        const deps = createBrowserDeps(createGlobals({ MessageChannel : FakeChannel }), options());

        expect(deps.MessageChannel).toBe(FakeChannel);
        expect(() => deps.queueMicrotask!(() => {})).not.toThrow();
        expect(createBrowserDeps(createGlobals({ MessageChannel : {} }), options()).MessageChannel).toBeUndefined();
    });

    it("leaves out requestAnimationFrame when the browser has no cancelAnimationFrame", () => {
        const deps = createBrowserDeps(createGlobals({ cancelAnimationFrame : undefined }), options());

        expect(deps.requestAnimationFrame).toBeUndefined();
        expect(deps.cancelAnimationFrame).toBeUndefined();
    });

    it("finds one memory API without the other, and leaves out a memory object that is null", () => {
        const legacy = createGlobals();
        const memory = { usedJSHeapSize : 1, totalJSHeapSize : 2, jsHeapSizeLimit : 3 };
        Object.assign(legacy.performance, { memory });
        const modern = createGlobals();
        Object.assign(modern.performance, { measureUserAgentSpecificMemory : () => Promise.resolve({ bytes : 42, breakdown : [] }) });
        const withNull = createGlobals();
        Object.assign(withNull.performance, { memory : null });

        expect(createBrowserDeps(legacy, options()).memorySource!.readLegacy!()).toBe(memory);
        expect(createBrowserDeps(modern, options()).memorySource!.measureModern).toBeTypeOf("function");
        expect(createBrowserDeps(modern, options()).memorySource!.readLegacy).toBeUndefined();
        expect(createBrowserDeps(withNull, options()).memorySource).toBeUndefined();
    });

    it("uses a crash-report object only when it has a set() function", () => {
        expect(createBrowserDeps(createGlobals({ crashReport : { initialize : vi.fn() } }), options()).crashReport).toBeUndefined();
    });

    it("gives FinalizationRegistry and ReportingObserver when the browser has them", () => {
        class FakeRegistry {}
        class FakeReportingObserver {}
        const deps = createBrowserDeps(createGlobals({ FinalizationRegistry : FakeRegistry, ReportingObserver : FakeReportingObserver }), options());

        expect(deps.FinalizationRegistry).toBe(FakeRegistry);
        expect(deps.ReportingObserver).toBe(FakeReportingObserver);
    });
});
