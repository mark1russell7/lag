import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstrumentedSchedulingFairness } from "./scheduling-fairness.js";
import { createMeasurementConditions } from "../measurement-conditions.js";
import { createFakeLifecycle } from "../vitals/test-fakes.js";
import { createRecordingMeter } from "../test-utils.js";
import type { MessageChannelConstructor, MessagePortLike } from "../SchedulingFairnessMonitor.js";

/**
 * The three scheduling primitives with queues that the test starts. The
 * clock is the clock of a fake lifecycle.
 */
function setup(withConditions : boolean) {
    const fake = createFakeLifecycle();
    const messages : Array<() => void> = [];
    const timeouts : Array<() => void> = [];
    const microtasks : Array<() => void> = [];
    let interval : (() => void) | undefined;
    class FakeChannel {
        readonly port1 : MessagePortLike = { postMessage : () => {}, onmessage : null, close : () => {} };
        readonly port2 : MessagePortLike = {
            postMessage : () => { messages.push(() => (this.port1.onmessage as (() => void) | null)?.()); },
            onmessage : null,
            close : () => {},
        };
    }
    const meter = createRecordingMeter();
    const conditions = withConditions
        ? createMeasurementConditions({
            clock : fake.clock,
            setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
            clearTimeoutFn : (id) => clearTimeout(id),
            lifecycle : fake.lifecycle,
        })
        : undefined;
    const handle = createInstrumentedSchedulingFairness({
        logger : { log : vi.fn() },
        clock : fake.clock,
        meter : meter.meter,
        setIntervalFn : (fn) => { interval = fn; return 1; },
        clearIntervalFn : () => { interval = undefined; },
        setTimeoutFn : (fn) => { timeouts.push(fn); return 1; },
        clearTimeoutFn : () => {},
        MessageChannel : FakeChannel as unknown as MessageChannelConstructor,
        queueMicrotask : (fn) => { microtasks.push(fn); },
    }, conditions);
    const run = (queue : Array<() => void>) => { for (const fn of queue.splice(0)) fn(); };
    return {
        fake,
        meter,
        handle,
        /** One cycle that starts at `start`: the microtask comes after 2 ms, the message after 30 ms, the timeout after `timeoutMs`. */
        cycle(start : number, timeoutMs : number) {
            fake.setNow(start);
            interval!();
            run(messages);
            fake.setNow(start + 2);
            run(microtasks);
            fake.setNow(start + 30);
            run(messages);
            fake.setNow(start + timeoutMs);
            run(timeouts);
        },
        intervalActive : () => interval !== undefined,
    };
}

describe("createInstrumentedSchedulingFairness", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("records the latency of each of the three primitives of a cycle", () => {
        const t = setup(false);

        t.cycle(1_000, 6);
        t.handle.stop();

        expect(t.handle.monitor).toBeDefined();
        expect(t.meter.values("lag_scheduling_microtask_histogram")).toEqual([2]);
        expect(t.meter.values("lag_scheduling_macrotask_histogram")).toEqual([6]);
        expect(t.meter.values("lag_scheduling_message_channel_histogram")).toEqual([30]);
    });

    it("with measurement conditions, validates a cycle by its longest latency", () => {
        const t = setup(true);

        // The timeout waits 6 s: the cycle is an outlier that waits for late evidence
        t.cycle(1_000, 6_000);
        expect(t.meter.values("lag_scheduling_macrotask_histogram")).toEqual([]);
        vi.advanceTimersByTime(2_000);

        expect(t.meter.values("lag_scheduling_macrotask_histogram")).toEqual([6_000]);
        expect(t.meter.values("lag_scheduling_microtask_histogram")).toEqual([2]);
    });

    it("with measurement conditions, stops while the page is hidden and starts again when it is visible", () => {
        const t = setup(true);

        t.fake.setVisibility("hidden");
        expect(t.intervalActive()).toBe(false);
        t.fake.setVisibility("visible");

        expect(t.intervalActive()).toBe(true);
    });

    it("stop() cancels the cycles that wait for evidence, and the page lifecycle does not start the monitor again", () => {
        const t = setup(true);
        t.cycle(1_000, 6_000);

        t.handle.stop();
        vi.advanceTimersByTime(3_000);
        t.fake.setVisibility("hidden");
        t.fake.setVisibility("visible");

        expect(t.meter.values("lag_scheduling_macrotask_histogram")).toEqual([]);
        expect(vi.getTimerCount()).toBe(0);
        expect(t.intervalActive()).toBe(false);
    });
});
