// async-browser-context patches the timers, the promises and the event listeners when it loads. Import it first.
import { AsyncLocalStorage, addCallbackHook } from "async-browser-context";
import { expect } from "vitest";
import { createBrowserDeps, setupAllMonitors, type Attributes, type EventSink, type Logger, type Meter } from "@mark1russell7/lag";
import { createInstrumentedLongCallbacks, setupLongCallbacks } from "@mark1russell7/lag/async-context";
import { blockMainThread, waitUntil } from "./harness.js";
import { environment } from "./commands.js";

/**
 * The add-on `@mark1russell7/lag/async-context` with the real runtime of
 * async-browser-context, without the transform: a timer callback, an event
 * listener and a promise reaction need no transform. The add-on must name
 * the function and the API of each long callback in each engine, also where
 * the browser has no Long Animation Frames (Firefox and WebKit).
 */

type Emitted = { name : string; attributes : Record<string, unknown>; time : number | undefined };

/** A meter and an event sink that keep the values of the long callbacks. */
function createRecorder() {
    const emitted : Emitted[] = [];
    const durations : Array<{ value : number; attributes : Attributes | undefined }> = [];
    const logs : Array<{ level : string; message : string }> = [];
    const meter : Meter = {
        createHistogram : (name) => ({
            record : (value, attributes) => {
                if (name === "lag_long_callback_duration_histogram") durations.push({ value, attributes });
            },
        }),
        createCounter : () => ({ add() {} }),
    };
    const events : EventSink = {
        emit : (name, attributes, options) => { emitted.push({ name, attributes : { ...attributes }, time : options?.time }); },
    };
    const logger : Logger = { log : (level, message) => { logs.push({ level, message }); } };
    return {
        meter,
        events,
        logger,
        durations,
        logs,
        /** The `lag.long_callback` events of the callback with this name. */
        longCallbacks : (callbackName : string) : Emitted[] =>
            emitted.filter(event => event.name === "lag.long_callback" && event.attributes["callback.name"] === callbackName),
    };
}

/** A named function that blocks the main thread for 150 ms. */
function fixedBlockingTask() : void {
    blockMainThread(150);
}

const clock = { now : () => performance.now() };

describe("Long callbacks (async-browser-context)", () => {
    it("names the function and the source setTimeout of a long timer callback", async () => {
        const recorder = createRecorder();
        const handle = createInstrumentedLongCallbacks({
            logger : recorder.logger,
            clock,
            meter : recorder.meter,
            events : recorder.events,
            performance,
            addCallbackHook,
        });
        expect(handle.monitor?.running).toBe(true);

        const scheduledAt = performance.now();
        setTimeout(fixedBlockingTask, 10);
        expect(await waitUntil(() => recorder.longCallbacks("fixedBlockingTask").length > 0, 10_000)).toBe(true);
        handle.stop();

        const [event] = recorder.longCallbacks("fixedBlockingTask");
        expect(event!.attributes).toMatchObject({ "callback.name" : "fixedBlockingTask", "callback.source" : "setTimeout", source_kind : "timer" });
        const durationMs = event!.attributes["duration_ms"] as number;
        // The hook reads the clock before and after the callback, thus the duration includes the full block
        expect(durationMs).toBeGreaterThanOrEqual(150);
        expect(durationMs).toBeLessThan(1_000);
        expect(recorder.durations).toContainEqual({ value : durationMs, attributes : { source_kind : "timer" } });
        // The time of the event is the start of the callback, after the timeout
        expect(event!.time! - performance.timeOrigin).toBeGreaterThan(scheduledAt);
        expect(recorder.logs).toEqual([]);
        console.log(`[${environment()}] long callback: fixedBlockingTask, setTimeout, ${durationMs.toFixed(1)} ms`);
    });

    it("gives the operation of the context, through setupAllMonitors and setupLongCallbacks, and stop() removes the hook", async () => {
        const recorder = createRecorder();
        const operation = new AsyncLocalStorage<string>();
        const monitors = setupAllMonitors(createBrowserDeps(window, {
            logger : recorder.logger,
            meter : recorder.meter,
            events : recorder.events,
            peerHangWatch : false,
            hangJournal : false,
        }));
        const handle = setupLongCallbacks(monitors, addCallbackHook, { operation : () => operation.getStore() });

        operation.run("checkout", () => setTimeout(fixedBlockingTask, 10));
        expect(await waitUntil(() => recorder.longCallbacks("fixedBlockingTask").length > 0, 10_000)).toBe(true);
        const viewId = monitors.vitals!.getView().id;
        monitors.stop();
        expect(handle.monitor?.running).toBe(false);

        const [event] = recorder.longCallbacks("fixedBlockingTask");
        expect(event!.attributes).toMatchObject({
            "callback.source" : "setTimeout",
            source_kind : "timer",
            operation : "checkout",
            "lag.page_view.id" : viewId,
        });

        // After stop(), the monitor reports nothing
        setTimeout(fixedBlockingTask, 0);
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(recorder.longCallbacks("fixedBlockingTask")).toHaveLength(1);
    });

    it("names the source of an event listener and of a promise reaction", async () => {
        const recorder = createRecorder();
        const handle = createInstrumentedLongCallbacks({ logger : recorder.logger, clock, meter : recorder.meter, events : recorder.events, addCallbackHook });
        const button = document.createElement("button");
        button.addEventListener("click", function onBuyClick() {
            blockMainThread(60);
        });

        button.click();
        await Promise.resolve().then(function afterLoad() {
            blockMainThread(60);
        });
        handle.stop();

        expect(recorder.longCallbacks("onBuyClick").map(event => event.attributes)).toEqual([
            expect.objectContaining({ "callback.source" : "addEventListener:click", source_kind : "event" }),
        ]);
        expect(recorder.longCallbacks("afterLoad").map(event => event.attributes)).toEqual([
            expect.objectContaining({ "callback.source" : "Promise.then", source_kind : "promise" }),
        ]);
    });
});
