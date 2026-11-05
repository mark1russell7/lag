import { describe, expect, it } from "vitest";
import { highFrequencyLagIntervalMs } from "./constants.js";
import { DriftLag } from "./DriftLag.js";
import { SimulatedThread } from "./test-thread.js";

/**
 * This file replays throttled timers on a simulated clock. No real browser and no real device gives these figures.
 * Each case has 26 positions: the block starts at each part of the grid. Two controls use the same thread. The control
 * "never" is the monitor without `postTask`, so no check says that the timers are throttled. The control "always" is the
 * same monitor, and it drops each value of a long step, as a monitor that always says throttled does.
 */
const POSITIONS = 26;
const NEVER_LONG_STEP_MS = 495;

type Replay = { readonly thread : SimulatedThread; taskMs : number; afterStep : (() => void) | undefined; readonly position : number };
type Script = (replay : Replay) => void;
type Read = { readonly largest : number; readonly paused : boolean; readonly messageAt : readonly number[]; readonly marked : readonly number[] };

const PAUSE_LOG = "DriftLag: the browser throttles the timers. The windows pause.";

function replay(script : Script, position : number, withPostTask = true, recordThrottledSteps = true) : Read & { readonly values : readonly number[] } {
    const thread = new SimulatedThread(1 / 64);
    thread.nestedTimerAlignmentMs = 4;
    const state : Replay = { thread, taskMs : 0, afterStep : undefined, position };
    const values : number[] = [];
    const messageAt : number[] = [];
    const marked : number[] = [];
    let recording = false;
    let paused = false;
    const monitor = new DriftLag(
        highFrequencyLagIntervalMs,
        (lag, source) => {
            if (!recording) return;
            values.push(lag);
            if (source === "throttled-step") marked.push(lag);
        },
        {
            log : (_level, message) => {
                if (message === PAUSE_LOG) paused = true;
            },
        },
        thread.setInterval,
        thread.clearInterval,
        (callback, ms) => thread.setTimeout(() => {
            callback();
            state.afterStep?.();
            if (state.taskMs > 0) thread.post(() => thread.busy(state.taskMs));
        }, ms),
        thread.clearTimeout,
        thread.clock,
        withPostTask ? {
            postTask : callback => {
                messageAt.push(thread.now);
                return thread.post(callback);
            },
            recordThrottledSteps,
        } : {},
    );
    thread.advance(3_000 + position * 4);
    recording = true;
    script(state);
    monitor.stop();
    return { values, largest : Math.max(0, ...values), paused, messageAt, marked };
}

const positions = (script : Script, withPostTask = true, recordThrottledSteps = true) : Array<ReturnType<typeof replay>> =>
    Array.from({ length : POSITIONS }, (_, position) => replay(script, position, withPostTask, recordThrottledSteps));

const median = (values : readonly number[]) : number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const form = (script : Script) : number[] => positions(script).map(read => read.largest);
const byDefault = (script : Script) : number[] => positions(script, true, false).map(read => read.largest);
const never = (script : Script) : number[] => positions(script, false).map(read => read.largest);
const always = (script : Script) : number[] =>
    positions(script, false).map(read => Math.max(0, ...read.values.filter(value => value < NEVER_LONG_STEP_MS)));

const grid = (thread : SimulatedThread, ms : number) : void => thread.setNestedTimerAlignment(ms);
const block = (thread : SimulatedThread, ms : number) : void => {
    thread.post(() => thread.busy(ms));
};
const endThrottling = (thread : SimulatedThread) : void => {
    grid(thread, 4);
    thread.advance(3_000);
};

const idle = (gridMs : number, ms : number) : Script => ({ thread }) => {
    grid(thread, gridMs);
    thread.advance(ms);
    endThrottling(thread);
};
const withTask = (taskMs : number) : Script => state => {
    grid(state.thread, 1_000);
    state.taskMs = taskMs;
    state.thread.advance(10_000);
    state.taskMs = 0;
    endThrottling(state.thread);
};
const blockAt = (gridMs : number, atMs : number, blockMs : number, taskMs = 0) : Script => state => {
    grid(state.thread, gridMs);
    state.taskMs = taskMs;
    state.thread.advance(atMs + state.position * gridMs * 0.037);
    block(state.thread, blockMs);
    state.thread.advance(blockMs + gridMs * 5);
    state.taskMs = 0;
    endThrottling(state.thread);
};
const changeGrid = (fromMs : number, toMs : number) : Script => ({ thread }) => {
    grid(thread, fromMs);
    thread.advance(fromMs * 7);
    grid(thread, toMs);
    thread.advance(toMs * 7);
    endThrottling(thread);
};
/** The timer fires after 3 steps of the grid and on the grid. */
const missedBeat : Script = state => {
    const { thread } = state;
    grid(thread, 1_000);
    thread.advance(6_000);
    state.afterStep = () => {
        if (Math.abs((thread.now - 370) % 3_000) > 20) return;
        thread.alignmentOffset = 370 / 3_000;
        grid(thread, 3_000);
        state.afterStep = () => {
            state.afterStep = undefined;
            thread.alignmentOffset = 0.37;
            grid(thread, 1_000);
        };
    };
    thread.advance(12_000);
    endThrottling(thread);
};
/** The timer waits, and the grid changes at a time off the grid. A waiting timer then fires at once. */
const wakeOffGrid = (stepMs : number) : Script => state => {
    const { thread } = state;
    grid(thread, 1_000);
    thread.advance(6_000);
    let stepped = false;
    state.afterStep = () => {
        state.afterStep = undefined;
        stepped = true;
        grid(thread, 1e9);
    };
    while (!stepped) thread.advance(1);
    thread.advance(stepMs - 120);
    grid(thread, 1_000);
    thread.advance(6_000);
    endThrottling(thread);
};

/** The same start as `wakeOffGrid`, with a real block in place of the wake. */
const blockAfterStep = (stepMs : number) : Script => state => {
    const { thread } = state;
    grid(thread, 1_000);
    thread.advance(6_000);
    let stepped = false;
    state.afterStep = () => {
        state.afterStep = undefined;
        stepped = true;
        block(thread, stepMs - 120);
    };
    while (!stepped) thread.advance(1);
    thread.advance(stepMs - 120);
    thread.advance(6_000);
    endThrottling(thread);
};

/** The time per minute from the first message to the last message of each chain of messages. */
const messageMsPerMinute = (messageAt : readonly number[], minutes : number) : number => {
    let totalMs = 0;
    let startAt : number | undefined;
    let lastAt = 0;
    for (const at of messageAt) {
        if (startAt === undefined || at - lastAt > 100) {
            if (startAt !== undefined) totalMs += lastAt - startAt;
            startAt = at;
        }
        lastAt = at;
    }
    if (startAt !== undefined) totalMs += lastAt - startAt;
    return totalMs / minutes;
};

describe("DriftLag in a replay of throttled timers", () => {
    describe("false lag", () => {
        for (const taskMs of [30, 45, 60, 200]) {
            it(`records no value for a grid of 1 s and a task of ${taskMs} ms after each step, and the control "never" records false lag`, () => {
                expect(Math.max(...form(withTask(taskMs)))).toBe(0);
                expect(positions(withTask(taskMs)).every(read => read.paused)).toBe(true);
                expect(median(never(withTask(taskMs)))).toBeGreaterThan(1_000);
            });
        }

        it("records no value for a grid of 60 s from the start", () => {
            expect(Math.max(...form(idle(60_000, 400_000)))).toBe(0);
            expect(median(never(idle(60_000, 400_000)))).toBeGreaterThan(1_000);
        });

        it("records no value when the grid changes from 1 s to 60 s, or from 60 s to 1 s", () => {
            expect(Math.max(...form(changeGrid(1_000, 60_000)))).toBe(0);
            expect(Math.max(...form(changeGrid(60_000, 1_000)))).toBe(0);
        });

        it("records no value for a timer that fires on the grid after 3 steps of the grid", () => {
            expect(Math.max(...form(missedBeat))).toBe(0);
        });

        // This is a limit of the method. One wake off the grid gives the same steps as a block, so it reads as a block.
        it("reads a wake off the grid as a block, and not as more than its step minus one step of the grid", () => {
            for (const stepMs of [3_000, 7_000]) {
                const read = form(wakeOffGrid(stepMs));
                expect(Math.max(...read)).toBeLessThanOrEqual(stepMs - 1_000);
                expect(Math.min(...read)).toBeGreaterThan(stepMs - 1_200);
            }
        });
    });

    describe("real blocks", () => {
        for (const [blockMs, taskMs] of [[2_500, 0], [6_000, 0], [2_500, 30], [6_000, 30]] as const) {
            it(`records a block of ${blockMs} ms at a grid of 1 s, with tasks of ${taskMs} ms, not above its size`, () => {
                const read = form(blockAt(1_000, 6_000, blockMs, taskMs));
                expect(Math.max(...read)).toBeLessThanOrEqual(blockMs);
                expect(median(read)).toBeGreaterThan(blockMs - 1_000);
                // A block that ends just after a step of the grid gives a next step of a full grid. It gives no value.
                expect(read.filter(value => value === 0).length).toBeLessThanOrEqual(2);
                // The control "always" reads a small part of the block, from the window that holds its first steps.
                expect(median(read)).toBeGreaterThan(median(always(blockAt(1_000, 6_000, blockMs, taskMs))) + 1_000);
            });
        }

        it("records a block of 200 s at a grid of 60 s, not above its size", () => {
            const read = form(blockAt(60_000, 300_000, 200_000));
            expect(Math.max(...read)).toBeLessThanOrEqual(200_000);
            expect(median(read)).toBeGreaterThan(140_000);
        });

        // These cases are limits of the method. Each one loses real lag, and each one records nothing false.
        it("records no value for a block that is shorter than the grid", () => {
            expect(Math.max(...form(blockAt(60_000, 300_000, 2_500)))).toBe(0);
        });

        it("records no value for most blocks of 1.5 steps of the grid", () => {
            const read = form(blockAt(60_000, 300_000, 90_000));
            expect(Math.max(...read)).toBeLessThanOrEqual(90_000);
            expect(read.filter(value => value === 0).length).toBeGreaterThan(POSITIONS / 2);
        });

        it("loses a part of the blocks before two steps of the grid agree, and does not overstate the others", () => {
            const read = form(state => {
                grid(state.thread, 1_000);
                state.thread.advance(1_500 + state.position * 37);
                block(state.thread, 2_500);
                state.thread.advance(8_000);
                endThrottling(state.thread);
            });
            expect(Math.max(...read)).toBeLessThanOrEqual(2_500);
            expect(read.filter(value => value === 0).length).toBeGreaterThan(0);
        });
    });

    describe("the mark of a value", () => {
        const LONG_MS = 495;

        for (const [name, script] of [
            ["a wake off the grid after 3 s", wakeOffGrid(3_000)],
            ["a wake off the grid after 7 s", wakeOffGrid(7_000)],
            ["a block of 2.5 s", blockAt(1_000, 6_000, 2_500)],
            ["a block of 6 s", blockAt(1_000, 6_000, 6_000)],
        ] as const) {
            it(`marks each long value of ${name}, and the value is the only long value of its run`, () => {
                const reads = positions(script);
                for (const read of reads) expect(read.values.filter(value => value >= LONG_MS)).toEqual(read.marked);
                expect(reads.some(read => read.marked.length > 0)).toBe(true);
            });
        }

        it("gives the same mark and the same value to a wake and to a block with the same steps: it cannot tell them", () => {
            for (const stepMs of [3_000, 7_000]) {
                const wakes = positions(wakeOffGrid(stepMs));
                const blocks = positions(blockAfterStep(stepMs));
                for (const [index, wake] of wakes.entries()) {
                    expect(wake.marked).toHaveLength(1);
                    expect(blocks[index]?.marked).toHaveLength(1);
                    expect(Math.abs(wake.marked[0]! - blocks[index]!.marked[0]!)).toBeLessThan(10);
                }
            }
        });

        it("gives no mark to a block with no throttling", () => {
            const script : Script = ({ thread }) => {
                block(thread, 2_500);
                thread.advance(3_000);
            };
            for (const read of positions(script)) {
                expect(read.largest).toBeGreaterThan(2_400);
                expect(read.marked).toEqual([]);
            }
        });

        it("records no value of a long step by default: a wake and a block read 0, and the task still reads no false lag", () => {
            for (const script of [wakeOffGrid(3_000), wakeOffGrid(7_000), blockAt(1_000, 6_000, 2_500), blockAt(1_000, 6_000, 6_000), withTask(30), withTask(200), blockAt(1_000, 6_000, 2_500, 30)]) {
                expect(Math.max(...byDefault(script))).toBeLessThan(LONG_MS);
            }
        });
    });

    describe("the cost of the check", () => {
        const MINUTES = 5;
        const loaded = (taskMs : number) : Script => ({ thread }) => {
            grid(thread, 1_000);
            thread.load(taskMs, thread.now + MINUTES * 60_000);
            thread.advance(MINUTES * 60_000);
        };

        for (const taskMs of [9, 12, 20, 30, 50, 100, 300, 700]) {
            it(`keeps its messages under 2 s per minute with back-to-back tasks of ${taskMs} ms`, () => {
                expect(messageMsPerMinute(replay(loaded(taskMs), 0).messageAt, MINUTES)).toBeLessThan(2_000);
            });
        }

        it("does not add messages on an idle page, or for a task after each step", () => {
            const idlePage : Script = ({ thread }) => {
                grid(thread, 1_000);
                thread.advance(MINUTES * 60_000);
            };
            expect(messageMsPerMinute(replay(idlePage, 0).messageAt, MINUTES)).toBeLessThan(150);
            const task : Script = state => {
                grid(state.thread, 1_000);
                state.taskMs = 30;
                state.thread.advance(MINUTES * 60_000);
            };
            expect(messageMsPerMinute(replay(task, 0).messageAt, MINUTES)).toBeLessThan(150);
        });
    });
});
