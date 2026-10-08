import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    LIVENESS_BUFFER_BYTES,
    LivenessWatcher,
    beatingSetTimeout,
    createLivenessBeacon,
    type LivenessBlock,
} from "./shared-liveness.js";

function createWatcher(options = { thresholdMs : 50, pollIntervalMs : 5 }) {
    let now = 0;
    const buffer = new SharedArrayBuffer(LIVENESS_BUFFER_BYTES);
    const beacon = createLivenessBeacon(buffer);
    const blocks : LivenessBlock[] = [];
    const watcher = new LivenessWatcher(
        buffer,
        (block) => blocks.push(block),
        { now : () => now },
        (fn, ms) => setInterval(fn, ms) as unknown as number,
        (id) => clearInterval(id),
        options,
    );
    return {
        beacon,
        watcher,
        blocks,
        /** This method moves the time forward. The main thread beats each `beatEveryMs`, but not when the value is 0. */
        run(ms : number, beatEveryMs = 5) {
            for (let t = 0; t < ms; t += 5) {
                now += 5;
                if (beatEveryMs > 0 && t % beatEveryMs === 0) beacon.beat();
                vi.advanceTimersByTime(5);
            }
        },
        jumpClock(ms : number) { now += ms; },
    };
}

describe("shared-memory liveness", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("reports nothing while the main thread beats", () => {
        const w = createWatcher();
        w.watcher.start();
        w.run(1_000);
        expect(w.blocks).toEqual([]);
    });

    it("reports a block when the counter stops changing, when it changes again", () => {
        const w = createWatcher();
        w.watcher.start();
        w.run(100);
        w.run(300, 0); // the main thread is blocked: no beats
        expect(w.blocks).toEqual([]);
        w.run(10);
        expect(w.blocks).toHaveLength(1);
        expect(w.blocks[0]!.durationMs).toBeGreaterThanOrEqual(300);
        expect(w.blocks[0]!.durationMs).toBeLessThanOrEqual(310);
    });

    it("ignores quiet periods shorter than the threshold", () => {
        const w = createWatcher();
        w.watcher.start();
        w.run(100);
        w.run(40, 0);
        w.run(20);
        expect(w.blocks).toEqual([]);
    });

    it("does not report time in which the watcher itself did not run", () => {
        const w = createWatcher();
        w.watcher.start();
        w.run(100);
        // The system sleeps: the watcher's next poll comes an hour late
        w.jumpClock(3_600_000);
        w.run(20);
        expect(w.blocks).toEqual([]);
    });

    it("stops polling on stop()", () => {
        const w = createWatcher();
        w.watcher.start();
        w.watcher.stop();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("beatingSetTimeout beats before each callback", () => {
        const buffer = new SharedArrayBuffer(LIVENESS_BUFFER_BYTES);
        const counter = new Int32Array(buffer);
        const callback = vi.fn(() => expect(Atomics.load(counter, 0)).toBe(1));
        const setTimeoutFn = beatingSetTimeout((fn, ms) => setTimeout(fn, ms) as unknown as number, createLivenessBeacon(buffer));

        setTimeoutFn(callback, 10);
        vi.advanceTimersByTime(10);

        expect(callback).toHaveBeenCalled();
    });

    it("uses a threshold of 50 ms and a poll interval of 5 ms by default", () => {
        let now = 0;
        const buffer = new SharedArrayBuffer(LIVENESS_BUFFER_BYTES);
        const beacon = createLivenessBeacon(buffer);
        const blocks : LivenessBlock[] = [];
        const setIntervalFn = vi.fn((fn : () => void, ms : number) => setInterval(fn, ms) as unknown as number);
        const watcher = new LivenessWatcher(buffer, (block) => blocks.push(block), { now : () => now }, setIntervalFn, (id) => clearInterval(id));
        const step = (beat : boolean) => {
            now += 5;
            if (beat) beacon.beat();
            vi.advanceTimersByTime(5);
        };

        watcher.start();
        for (let i = 0; i < 20; i++) step(true);
        for (let i = 0; i < 11; i++) step(false);
        step(true);
        watcher.stop();

        expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 5);
        expect(blocks).toEqual([{ startedAt : 100, durationMs : 60 }]);
    });

    it("start() while the watcher operates adds no second poll", () => {
        const w = createWatcher();
        w.watcher.start();
        w.watcher.start();
        w.watcher.stop();

        expect(vi.getTimerCount()).toBe(0);
    });

    it("reports a quiet period of exactly the threshold", () => {
        const w = createWatcher();
        w.watcher.start();
        w.run(100);
        w.run(45, 0);
        w.run(5);

        expect(w.blocks).toEqual([{ startedAt : 100, durationMs : 50 }]);
    });

    it("measures a block also when one poll of the watcher is late by less than the threshold", () => {
        const w = createWatcher();
        w.watcher.start();
        w.run(100);
        w.run(100, 0);
        // The next poll comes 40 ms late
        w.jumpClock(40);
        w.run(100, 0);
        w.run(10);

        expect(w.blocks).toEqual([{ startedAt : 100, durationMs : 245 }]);
    });

    it("does not count the time in which the watcher itself was late by exactly the threshold", () => {
        const w = createWatcher();
        w.watcher.start();
        w.run(100);
        w.run(100, 0);
        // The next poll comes 50 ms late: the block starts again at that poll
        w.jumpClock(50);
        w.run(100, 0);
        w.run(10);

        expect(w.blocks).toEqual([{ startedAt : 255, durationMs : 100 }]);
    });
});
