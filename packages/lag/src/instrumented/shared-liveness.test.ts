import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstrumentedSharedLiveness } from "./shared-liveness.js";
import { createMeasurementConditions } from "../measurement-conditions.js";
import { LIVENESS_BUFFER_BYTES } from "../shared-liveness.js";
import { createFakeLifecycle } from "../vitals/test-fakes.js";
import { createRecordingMeter } from "../test-utils.js";
import type { WorkerLike } from "../WorkerLagMonitor.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "../worker-protocol.js";

function setup(withConditions : boolean) {
    const fake = createFakeLifecycle();
    const listeners = new Set<(event : { data : WorkerToMainMessage }) => void>();
    const sent : MainToWorkerMessage[] = [];
    const worker : WorkerLike = {
        postMessage : (message) => { sent.push(message); },
        addEventListener : (_type, listener) => { listeners.add(listener); },
        removeEventListener : (_type, listener) => { listeners.delete(listener); },
    };
    const meter = createRecordingMeter();
    const conditions = withConditions
        ? createMeasurementConditions({
            clock : fake.clock,
            setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
            clearTimeoutFn : (id) => clearTimeout(id),
            lifecycle : fake.lifecycle,
        })
        : undefined;
    const handle = createInstrumentedSharedLiveness({
        logger : { log : vi.fn() },
        clock : fake.clock,
        meter : meter.meter,
        worker,
        livenessBuffer : new SharedArrayBuffer(LIVENESS_BUFFER_BYTES),
    }, conditions);
    return {
        fake,
        meter,
        handle,
        sent : () => sent.map(message => message.type),
        /** The worker reports a block that ended at this time. */
        block(durationMs : number) {
            for (const listener of [...listeners]) listener({ data : { type : "liveness-block", startedAt : 0, durationMs } });
        },
    };
}

describe("createInstrumentedSharedLiveness", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("records the duration of each block that the worker saw", () => {
        const t = setup(false);

        t.block(230);
        t.block(75);
        t.handle.stop();

        expect(t.handle.monitor).toBeDefined();
        expect(t.meter.values("lag_liveness_block_histogram")).toEqual([230, 75]);
        expect(t.sent()).toEqual(["liveness-start", "liveness-stop"]);
    });

    it("with measurement conditions, stops the watcher while the page is hidden, and does not record a block that overlaps the hidden period", () => {
        const t = setup(true);
        t.fake.setNow(1_000);
        t.fake.setVisibility("hidden");
        expect(t.sent()).toEqual(["liveness-start", "liveness-stop"]);

        t.fake.setNow(5_000);
        t.fake.setVisibility("visible");
        // This block started before the page became hidden
        t.block(4_500);
        t.fake.setNow(6_000);
        t.block(200);

        expect(t.sent()).toEqual(["liveness-start", "liveness-stop", "liveness-start"]);
        expect(t.meter.values("lag_liveness_block_histogram")).toEqual([200]);
    });

    it("stop() stops the watcher, cancels the blocks that wait for evidence, and ends the pause", () => {
        const t = setup(true);
        t.fake.setNow(10_000);
        t.block(6_000);

        t.handle.stop();
        vi.advanceTimersByTime(3_000);
        t.fake.setVisibility("hidden");
        t.fake.setVisibility("visible");

        expect(t.meter.values("lag_liveness_block_histogram")).toEqual([]);
        expect(t.sent()).toEqual(["liveness-start", "liveness-stop"]);
        expect(vi.getTimerCount()).toBe(0);
    });
});
