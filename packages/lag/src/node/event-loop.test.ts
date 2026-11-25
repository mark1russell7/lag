import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { watchEventLoop, type DelayHistogram, type EventLoopWatchDeps, type EventLoopWatchOptions, type GcPause, type LoopActivity } from "./event-loop.js";

type FakeTimer = {
    readonly handler : () => void;
    refed : boolean;
    fired : boolean;
    cleared : boolean;
    unref() : FakeTimer;
};

type FakeHistogram = DelayHistogram & {
    enabled : boolean;
    resets : number;
    resolutionMs : number | undefined;
    count : number;
    min : number;
    max : number;
    mean : number;
    stddev : number;
    readonly percentiles : Map<number, number>;
};

/** This function gives a clock, a timer and a histogram that the test controls. The watch chains one timer at a time. */
function fakeDeps() : { deps : EventLoopWatchDeps<FakeTimer>; timers : FakeTimer[]; histogram : FakeHistogram; tickAt : (time : number) => void; setNow : (time : number) => void } {
    let now = 0;
    const timers : FakeTimer[] = [];
    const histogram : FakeHistogram = {
        enabled : false,
        resets : 0,
        resolutionMs : undefined,
        count : 0,
        min : 0,
        max : 0,
        mean : 0,
        stddev : 0,
        percentiles : new Map(),
        enable() {
            this.enabled = true;
            return true;
        },
        disable() {
            this.enabled = false;
            return true;
        },
        reset() {
            this.resets += 1;
            this.count = 0;
        },
        percentile(percentile) {
            return this.percentiles.get(percentile) ?? 0;
        },
    };
    const deps : EventLoopWatchDeps<FakeTimer> = {
        clock : { now : () => now },
        setTimeout : (handler) => {
            const timer : FakeTimer = {
                handler,
                refed : true,
                fired : false,
                cleared : false,
                unref() {
                    this.refed = false;
                    return this;
                },
            };
            timers.push(timer);
            return timer;
        },
        clearTimeout : (timer) => {
            timer.cleared = true;
        },
        histogram : (resolutionMs) => {
            histogram.resolutionMs = resolutionMs;
            return histogram;
        },
    };
    const tickAt = (time : number) : void => {
        now = time;
        const pending = timers.filter((timer) => !timer.fired && !timer.cleared);
        expect(pending).toHaveLength(1);
        const [timer] = pending;
        if (timer === undefined) return;
        timer.fired = true;
        timer.handler();
    };
    return { deps, timers, histogram, tickAt, setNow : (time) => { now = time; } };
}

describe("watchEventLoop", () => {
    it("keeps a gap over the limit as a block, with the tick before the gap as its start", () => {
        const { deps, tickAt, setNow } = fakeDeps();
        const watch = watchEventLoop({}, deps);
        for (const time of [10, 20, 150, 160]) tickAt(time);
        setNow(165);
        expect(watch.span()).toEqual({
            startedAt : 0,
            durationMs : 165,
            resolutionMs : 10,
            limitMs : 50,
            longestMs : 130,
            blockCount : 1,
            blocks : [{ startedAt : 20, durationMs : 130 }],
            delay : undefined,
        });
    });

    it("keeps no block for a gap at the limit, and gives the longest gap", () => {
        const { deps, tickAt, setNow } = fakeDeps();
        const watch = watchEventLoop({ limitMs : 50 }, deps);
        tickAt(50);
        tickAt(60);
        setNow(61);
        const span = watch.span();
        expect(span.blocks).toEqual([]);
        expect(span.blockCount).toBe(0);
        expect(span.longestMs).toBe(50);
    });

    it("closes the open gap at the time of span(), and starts the next span there", () => {
        const { deps, tickAt, setNow } = fakeDeps();
        const watch = watchEventLoop({}, deps);
        tickAt(10);
        setNow(100);
        expect(watch.span().blocks).toEqual([{ startedAt : 10, durationMs : 90 }]);
        tickAt(110);
        setNow(115);
        const next = watch.span();
        expect(next.startedAt).toBe(100);
        expect(next.durationMs).toBe(15);
        expect(next.blocks).toEqual([]);
        expect(next.longestMs).toBe(10);
    });

    it("gives the delay of the histogram in milliseconds, and resets the histogram for each span", () => {
        const { deps, histogram, setNow } = fakeDeps();
        const watch = watchEventLoop({ resolutionMs : 20 }, deps);
        expect(histogram.enabled).toBe(true);
        expect(histogram.resolutionMs).toBe(20);
        Object.assign(histogram, { count : 3, min : 1e6, max : 2.5e7, mean : 1e7, stddev : 2e6 });
        histogram.percentiles.set(50, 9e6).set(90, 2e7).set(99, 2.4e7);
        setNow(30);
        expect(watch.span().delay).toEqual({ count : 3, minMs : 1, maxMs : 25, meanMs : 10, stddevMs : 2, p50Ms : 9, p90Ms : 20, p99Ms : 24 });
        expect(histogram.resets).toBe(1);
        expect(watch.span().delay).toBeUndefined();
    });

    it("gives the busy part of each span from the activity of the loop, and no busy part for a span with no time", () => {
        const { deps, setNow } = fakeDeps();
        let activity : LoopActivity = { active : 0, idle : 0 };
        const watch = watchEventLoop({}, { ...deps, activity : () => activity });
        activity = { active : 30, idle : 90 };
        setNow(120);
        expect(watch.span().busy).toEqual({ activeMs : 30, idleMs : 90, utilization : 0.25 });
        expect(watch.span().busy).toBeUndefined();
        activity = { active : 80, idle : 140 };
        setNow(220);
        expect(watch.span().busy).toEqual({ activeMs : 50, idleMs : 50, utilization : 0.5 });
    });

    it("gives no busy part when the deps give no activity", () => {
        const { deps, setNow } = fakeDeps();
        const watch = watchEventLoop({}, deps);
        setNow(100);
        expect(watch.span().busy).toBeUndefined();
    });

    it("gives busy parts from 0 to 1 that add up to the activity of the whole watch (property test)", () => {
        const step = fc.record({ active : fc.integer({ min : 0, max : 1000 }), idle : fc.integer({ min : 0, max : 1000 }) });
        fc.assert(fc.property(fc.array(step, { maxLength : 50 }), (steps) => {
            const { deps, setNow } = fakeDeps();
            let activity : LoopActivity = { active : 0, idle : 0 };
            const watch = watchEventLoop({}, { ...deps, activity : () => activity });
            let active = 0;
            let idle = 0;
            steps.forEach((each, index) => {
                activity = { active : activity.active + each.active, idle : activity.idle + each.idle };
                setNow(index + 1);
                const busy = watch.span().busy;
                if (busy === undefined) {
                    expect(each.active + each.idle).toBe(0);
                    return;
                }
                expect(busy.utilization).toBeGreaterThanOrEqual(0);
                expect(busy.utilization).toBeLessThanOrEqual(1);
                active += busy.activeMs;
                idle += busy.idleMs;
            });
            expect({ active, idle }).toEqual(activity);
        }));
    });

    it("keeps the first blocks up to its maximum, and counts each block", () => {
        const { deps, tickAt, setNow } = fakeDeps();
        const watch = watchEventLoop({ maxBlocks : 2 }, deps);
        for (const time of [100, 200, 300]) tickAt(time);
        setNow(305);
        const span = watch.span();
        expect(span.blocks).toEqual([{ startedAt : 0, durationMs : 100 }, { startedAt : 100, durationMs : 100 }]);
        expect(span.blockCount).toBe(3);
    });

    it("calls unref() on each timer", () => {
        const { deps, timers, tickAt } = fakeDeps();
        watchEventLoop({}, deps);
        for (const time of [10, 20, 30]) tickAt(time);
        expect(timers).toHaveLength(4);
        expect(timers.every((timer) => !timer.refed)).toBe(true);
    });

    it("stops the timer and the histogram, and refuses a span after stop()", () => {
        const { deps, timers, histogram } = fakeDeps();
        const watch = watchEventLoop({}, deps);
        watch.stop();
        watch.stop();
        expect(timers.map((timer) => timer.cleared)).toEqual([true]);
        expect(histogram.enabled).toBe(false);
        expect(() => watch.span()).toThrow("span() after stop()");
    });

    it.each<EventLoopWatchOptions>([
        { resolutionMs : 0 },
        { resolutionMs : 1.5 },
        { limitMs : -1 },
        { limitMs : Number.NaN },
        { limitMs : Number.POSITIVE_INFINITY },
        { maxBlocks : -1 },
        { maxBlocks : 0.5 },
    ])("refuses the option %o", (options) => {
        expect(() => watchEventLoop(options, fakeDeps().deps)).toThrow(RangeError);
    });

    it("gives blocks over the limit, in sequence, inside the span, and fewer blocks for a higher limit (property test)", () => {
        fc.assert(fc.property(
            fc.array(fc.integer({ min : 1, max : 500 }), { maxLength : 100 }),
            fc.integer({ min : 0, max : 300 }),
            fc.integer({ min : 0, max : 300 }),
            (gaps, limitMs, more) => {
                const spanOf = (limit : number) => {
                    const { deps, tickAt, setNow } = fakeDeps();
                    const watch = watchEventLoop({ limitMs : limit }, deps);
                    let time = 0;
                    for (const gap of gaps) tickAt((time += gap));
                    setNow(time);
                    return watch.span();
                };
                const span = spanOf(limitMs);
                const end = span.startedAt + span.durationMs;
                expect(span.blockCount).toBe(span.blocks.length);
                span.blocks.forEach((block, index) => {
                    expect(block.durationMs).toBeGreaterThan(limitMs);
                    expect(block.startedAt).toBeGreaterThanOrEqual(span.startedAt);
                    expect(block.startedAt + block.durationMs).toBeLessThanOrEqual(end);
                    expect(span.longestMs).toBeGreaterThanOrEqual(block.durationMs);
                    const next = span.blocks[index + 1];
                    if (next !== undefined) expect(block.startedAt + block.durationMs).toBeLessThanOrEqual(next.startedAt);
                });
                expect(span.longestMs).toBeLessThanOrEqual(span.durationMs);
                // A metamorphic relation: a higher limit keeps a part of the blocks of the lower limit.
                const higher = spanOf(limitMs + more).blocks;
                expect(higher.every((block) => span.blocks.some((each) => each.startedAt === block.startedAt))).toBe(true);
            },
        ));
    });
});

describe("the CPU time and the pause time of a block", () => {
    it("gives the CPU time of the thread and the major faults of the process from the tick before the block to the tick after it", () => {
        const { deps, tickAt, setNow } = fakeDeps();
        let cpu = 5;
        let faults = 100;
        const watch = watchEventLoop({}, { ...deps, cpu : () => cpu, faults : () => faults });
        cpu = 8;
        tickAt(10);
        // A block of 130 ms with 20 ms of CPU time and 40 faults: the thread waited for 110 ms, for pages of the disk.
        cpu = 28;
        faults = 140;
        tickAt(140);
        cpu = 29;
        faults = 141;
        tickAt(150);
        setNow(150);
        expect(watch.span().blocks).toEqual([{ startedAt : 10, durationMs : 130, cpuMs : 20, majorFaults : 40 }]);
    });

    it("gives the part of each pause inside each block, and forgets the pauses of a span at its read", () => {
        const { deps, tickAt, setNow } = fakeDeps();
        let pauses : GcPause[] = [];
        let stopped = 0;
        const gc = () => ({
            take : () => {
                const taken = pauses;
                pauses = [];
                return taken;
            },
            stop : () => {
                stopped += 1;
            },
        });
        const watch = watchEventLoop({}, { ...deps, gc });
        tickAt(10);
        tickAt(110);
        tickAt(120);
        tickAt(300);
        // One pause inside the first block, one across its end, one before the span, one in the second block.
        pauses = [{ startTime : 20, duration : 30 }, { startTime : 100, duration : 15 }, { startTime : 0, duration : 5 }, { startTime : 200, duration : 50 }];
        setNow(300);
        expect(watch.span().blocks).toEqual([
            { startedAt : 10, durationMs : 100, gcMs : 40 },
            { startedAt : 120, durationMs : 180, gcMs : 50 },
        ]);
        tickAt(400);
        setNow(400);
        expect(watch.span().blocks).toEqual([{ startedAt : 300, durationMs : 100, gcMs : 0 }]);
        watch.stop();
        watch.stop();
        expect(stopped).toBe(1);
    });
});

describe("watchEventLoop on Node.js", () => {
    it("finds a busy wait of 120 ms as a block, in the histogram and in the busy part of the loop", async () => {
        const watch = watchEventLoop({ limitMs : 50 });
        await sleep(30);
        const end = performance.now() + 120;
        while (performance.now() < end) {
            // The busy wait blocks the event loop.
        }
        await sleep(30);
        const span = watch.span();
        watch.stop();
        // A block of d ms gives a gap of d ms or more, also on a machine with load. Thus these bounds hold on each run.
        expect(span.blocks.some((block) => block.durationMs >= 120)).toBe(true);
        expect(span.longestMs).toBeGreaterThanOrEqual(120);
        expect(span.delay?.maxMs ?? 0).toBeGreaterThanOrEqual(100);
        // The busy wait is active time of the loop.
        expect(span.busy?.activeMs ?? 0).toBeGreaterThanOrEqual(100);
        expect(span.busy?.utilization ?? 2).toBeLessThanOrEqual(1);
        // The busy wait is CPU time of the thread.
        const block = span.blocks.find((item) => item.durationMs >= 120);
        expect(block?.cpuMs ?? 0).toBeGreaterThanOrEqual(40);
        expect(block?.gcMs).toBeTypeOf("number");
        expect(block?.majorFaults).toBeTypeOf("number");
    });

    it("gives a block that waits with no CPU time much less CPU time than its length", async () => {
        const watch = watchEventLoop({ limitMs : 50 });
        await sleep(30);
        // Atomics.wait stops the thread with no work, as a page of swap or a synchronous read of a disk does.
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
        await sleep(30);
        const span = watch.span();
        watch.stop();
        const block = span.blocks.find((item) => item.durationMs >= 200);
        expect(block).toBeDefined();
        expect(block?.cpuMs ?? 1000).toBeLessThan(100);
    });

    it("does not keep a process alive", () => {
        const entry = pathToFileURL(fileURLToPath(new URL("./event-loop.ts", import.meta.url))).href;
        const script = "const { watchEventLoop } = await import(process.argv[1]); watchEventLoop();";
        const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script, entry], { encoding : "utf8", timeout : 20_000 });
        expect(child.error).toBeUndefined();
        expect(child.signal).toBeNull();
        expect(child.stderr).not.toMatch(/Error/);
        expect(child.status).toBe(0);
    });
});
