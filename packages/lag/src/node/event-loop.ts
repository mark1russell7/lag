import { monitorEventLoopDelay, performance, PerformanceObserver } from "node:perf_hooks";
import type { Clock } from "../types.js";

/** The default step of the timer of the watch and the default resolution of its histogram, in milliseconds. */
export const EVENT_LOOP_RESOLUTION_MS = 10 as const;
/** The default limit of a block, in milliseconds. It is the limit of a long task in browsers. */
export const EVENT_LOOP_BLOCK_LIMIT_MS = 50 as const;
/** The default count of blocks that one span keeps. The field `blockCount` counts each block. */
export const EVENT_LOOP_MAX_BLOCKS = 1000 as const;

/**
 * A block of the event loop: a gap between two ticks of the timer of the watch that is longer than the limit. The
 * record has the shape of the block records of the browser monitors (`startedAt`, `durationMs`).
 */
export type LoopBlock = {
    /** The time of the tick before the block, on the clock of the watch. */
    readonly startedAt : number;
    /**
     * The time from the tick before the block to the tick after it, in milliseconds. A block of `d` ms gives a gap from
     * `d` to `d` plus the resolution.
     */
    readonly durationMs : number;
    /**
     * The CPU time of the thread from the tick before the block to the tick after it, in milliseconds. A block with much less
     * CPU time than its length waited: for example for a page of swap or a synchronous read of a disk. It is `undefined` when
     * the deps give no CPU time.
     */
    readonly cpuMs? : number | undefined;
    /**
     * The count of the major page faults of the process in the block. Each fault is a read of a page from the disk, for
     * example from swap. A block that waited with no fault waited for something else, for example a synchronous read of a file. It is
     * `undefined` when the deps give no fault count.
     */
    readonly majorFaults? : number | undefined;
    /**
     * The time of the pauses of the garbage collector inside the block, in milliseconds. It is `undefined` when the deps give
     * no pauses. A pause that the deps give after the read of the span counts in no block.
     */
    readonly gcMs? : number | undefined;
};

/** A pause of the garbage collector: a `gc` entry of `PerformanceObserver`, on the clock of the watch. */
export type GcPause = {
    readonly startTime : number;
    readonly duration : number;
};

/** A source of the pauses of the garbage collector. */
export type GcPauses = {
    /** This method gives the pauses since its previous call, and it forgets them. */
    take() : readonly GcPause[];
    /** This method stops the source. */
    stop() : void;
};

/**
 * The delay of the event loop in one span, from the histogram of `monitorEventLoopDelay`, in milliseconds. Each sample is
 * the time between two firings of the timer of the histogram. Thus an idle loop gives samples near the resolution.
 */
export type LoopDelay = {
    /** The count of samples of the histogram. */
    readonly count : number;
    readonly minMs : number;
    readonly maxMs : number;
    readonly meanMs : number;
    readonly stddevMs : number;
    readonly p50Ms : number;
    readonly p90Ms : number;
    readonly p99Ms : number;
};

/**
 * The busy part of the event loop in one span, from `performance.eventLoopUtilization()`, in milliseconds. The loop is idle
 * while it waits for events, and it is active for the rest of the time.
 */
export type LoopBusy = {
    /** The time of the span that the loop was active. */
    readonly activeMs : number;
    /** The time of the span that the loop waited for events. */
    readonly idleMs : number;
    /** The active part of the span: `activeMs` divided by the sum of `activeMs` and `idleMs`, from 0 to 1. */
    readonly utilization : number;
};

/** The record of one span of the event loop. All times are on the clock of the watch, in milliseconds. */
export type LoopSpan = {
    readonly startedAt : number;
    readonly durationMs : number;
    /** The step of the timer and the resolution of the histogram. */
    readonly resolutionMs : number;
    /** The limit of a block. */
    readonly limitMs : number;
    /** The longest gap between two ticks of the span. It includes the gaps under the limit. */
    readonly longestMs : number;
    /** The count of all blocks of the span. It is more than the length of `blocks` when the span has more blocks than its maximum. */
    readonly blockCount : number;
    /** The first blocks of the span, in their sequence. */
    readonly blocks : readonly LoopBlock[];
    /** The histogram of the span. It is `undefined` when the span has no sample. */
    readonly delay : LoopDelay | undefined;
    /** The busy part of the loop in the span. It is `undefined` when the deps give no activity, or when the span has no time. */
    readonly busy? : LoopBusy | undefined;
};

/** The options of `watchEventLoop()`. */
export type EventLoopWatchOptions = {
    /** The step of the timer and the resolution of the histogram, in whole milliseconds. The default is 10. */
    readonly resolutionMs? : number;
    /** A gap between two ticks that is longer than this limit is a block. The default is 50 ms. */
    readonly limitMs? : number;
    /** The most blocks that one span keeps. The default is 1000. */
    readonly maxBlocks? : number;
};

/** A timer handle of Node.js. The watch unrefs each timer, thus the timer does not keep the process alive. */
export type NodeTimer = {
    unref() : unknown;
};

/** The part of the `IntervalHistogram` of `node:perf_hooks` that the watch reads. Its values are in nanoseconds. */
export type DelayHistogram = {
    enable() : unknown;
    disable() : unknown;
    reset() : void;
    readonly count : number;
    readonly min : number;
    readonly max : number;
    readonly mean : number;
    readonly stddev : number;
    percentile(percentile : number) : number;
};

/**
 * The part of `performance.eventLoopUtilization()` of `node:perf_hooks` that the watch reads: the active time and the idle
 * time of the loop from its start, in milliseconds.
 */
export type LoopActivity = {
    readonly active : number;
    readonly idle : number;
};

/** The dependencies of `watchEventLoop()`. A test gives a clock, timers and a histogram that it controls. */
export type EventLoopWatchDeps<Timer extends NodeTimer> = {
    readonly clock : Clock;
    readonly setTimeout : (handler : () => void, ms : number) => Timer;
    readonly clearTimeout : (timer : Timer) => void;
    readonly histogram : (resolutionMs : number) => DelayHistogram;
    /** This function gives the activity of the loop. Without it, the spans have no busy part. */
    readonly activity? : (() => LoopActivity) | undefined;
    /** This function gives the CPU time of the thread from its start, in milliseconds. Without it, the blocks have no CPU time. */
    readonly cpu? : (() => number) | undefined;
    /** This function gives the count of the major page faults of the process from its start. Without it, the blocks have no count. */
    readonly faults? : (() => number) | undefined;
    /** This function starts a source of the pauses of the garbage collector. Without it, the blocks have no pause time. */
    readonly gc? : (() => GcPauses) | undefined;
};

/** A running watch of the event loop. */
export type EventLoopWatch = {
    /**
     * This method gives the record of the span from the previous call, or from the start, to this call. Then it starts
     * the next span. It closes the open gap of the timer at the time of the call. It throws after `stop()`.
     */
    span() : LoopSpan;
    /** This method stops the timer and the histogram. A second call does nothing. */
    stop() : void;
};

const NODE_DEPS : EventLoopWatchDeps<NodeJS.Timeout> = {
    clock : performance,
    setTimeout : (handler, ms) => setTimeout(handler, ms),
    clearTimeout : (timer) => {
        clearTimeout(timer);
    },
    histogram : (resolutionMs) => monitorEventLoopDelay({ resolution : resolutionMs }),
    activity : () => performance.eventLoopUtilization(),
    cpu : threadCpuMs,
    faults : () => process.resourceUsage().majorPageFault,
    gc : observeGc,
};

/** This function gives the CPU time of the thread. A Node.js with no `process.threadCpuUsage` gives the time of the process. */
function threadCpuMs() : number {
    const used = typeof process.threadCpuUsage === "function" ? process.threadCpuUsage() : process.cpuUsage();
    return (used.user + used.system) / 1000;
}

/** This function observes the `gc` entries of `node:perf_hooks`. The observer does not keep the process alive. */
function observeGc() : GcPauses {
    let pauses : GcPause[] = [];
    const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) pauses.push({ startTime : entry.startTime, duration : entry.duration });
    });
    observer.observe({ entryTypes : ["gc"] });
    return {
        take : () => {
            const taken = pauses;
            pauses = [];
            return taken;
        },
        stop : () => {
            observer.disconnect();
        },
    };
}

/** This function gives the time of the pauses inside a block. A pause across an edge of the block counts with its part inside. */
function gcInside(block : LoopBlock, pauses : readonly GcPause[]) : number {
    const end = block.startedAt + block.durationMs;
    let sum = 0;
    for (const pause of pauses) sum += Math.max(0, Math.min(end, pause.startTime + pause.duration) - Math.max(block.startedAt, pause.startTime));
    return sum;
}

const NS_PER_MS = 1e6;

/** This function gives the delay of a span from the histogram, or `undefined` when the histogram has no sample. */
function delayOf(histogram : DelayHistogram) : LoopDelay | undefined {
    if (histogram.count === 0) return undefined;
    return {
        count : histogram.count,
        minMs : histogram.min / NS_PER_MS,
        maxMs : histogram.max / NS_PER_MS,
        meanMs : histogram.mean / NS_PER_MS,
        stddevMs : histogram.stddev / NS_PER_MS,
        p50Ms : histogram.percentile(50) / NS_PER_MS,
        p90Ms : histogram.percentile(90) / NS_PER_MS,
        p99Ms : histogram.percentile(99) / NS_PER_MS,
    };
}

/** This function gives the busy part of a span from the activity at its start and at its end. A span with no time has none. */
function busyOf(start : LoopActivity | undefined, end : LoopActivity | undefined) : LoopBusy | undefined {
    if (start === undefined || end === undefined) return undefined;
    const activeMs = end.active - start.active;
    const idleMs = end.idle - start.idle;
    const totalMs = activeMs + idleMs;
    if (!(totalMs > 0)) return undefined;
    return { activeMs, idleMs, utilization : activeMs / totalMs };
}

function checked(name : string, value : number, valid : boolean) : number {
    if (!valid) throw new RangeError(`The option ${name} of watchEventLoop() is not valid: ${String(value)}.`);
    return value;
}

/**
 * This function starts a watch of the event loop of Node.js. The watch has meters, and each span of the caller
 * gets a record of each.
 *
 * - The histogram of `monitorEventLoopDelay` gives the distribution of the delay of the loop.
 * - A timer of the watch ticks at each step. Each gap between two ticks over the limit is a block, with its start.
 * - `performance.eventLoopUtilization()` gives the busy part of the loop: its active time and its idle time.
 * - Three meters give the cause of each block. They are the CPU time of the thread, the major page faults of the process
 *   and the `gc` entries of `PerformanceObserver`. Thus a block that waited shows apart from a block of work.
 *
 * The watch uses `unref()` on each timer, thus the watch does not keep the process alive.
 *
 * ```ts
 * const watch = watchEventLoop({ limitMs: 100 });
 * await start();
 * const { longestMs, blocks } = watch.span();
 * watch.stop();
 * ```
 */
export function watchEventLoop(options? : EventLoopWatchOptions) : EventLoopWatch;
export function watchEventLoop<Timer extends NodeTimer>(options : EventLoopWatchOptions, deps : EventLoopWatchDeps<Timer>) : EventLoopWatch;
export function watchEventLoop<Timer extends NodeTimer>(
    options : EventLoopWatchOptions = {},
    deps? : EventLoopWatchDeps<Timer>,
) : EventLoopWatch {
    if (deps === undefined) return watchWith(options, NODE_DEPS);
    return watchWith(options, deps);
}

function watchWith<Timer extends NodeTimer>(options : EventLoopWatchOptions, deps : EventLoopWatchDeps<Timer>) : EventLoopWatch {
    const resolutionMs = options.resolutionMs ?? EVENT_LOOP_RESOLUTION_MS;
    const limitMs = options.limitMs ?? EVENT_LOOP_BLOCK_LIMIT_MS;
    const maxBlocks = options.maxBlocks ?? EVENT_LOOP_MAX_BLOCKS;
    checked("resolutionMs", resolutionMs, Number.isInteger(resolutionMs) && resolutionMs >= 1);
    checked("limitMs", limitMs, Number.isFinite(limitMs) && limitMs >= 0);
    checked("maxBlocks", maxBlocks, Number.isInteger(maxBlocks) && maxBlocks >= 0);

    const histogram = deps.histogram(resolutionMs);
    histogram.enable();
    let spanStart = deps.clock.now();
    let activityStart = deps.activity?.();
    const gc = deps.gc?.();
    let last = spanStart;
    let lastCpu = deps.cpu?.();
    let lastFaults = deps.faults?.();
    let longestMs = 0;
    let blockCount = 0;
    let blocks : LoopBlock[] = [];
    let stopped = false;

    // The step of the fold over the ticks: the gap from the previous tick to this time.
    const close = (now : number) : void => {
        const gap = now - last;
        const cpu = deps.cpu?.();
        const faults = deps.faults?.();
        if (gap > longestMs) longestMs = gap;
        if (gap > limitMs) {
            blockCount += 1;
            const cpuMs = cpu === undefined || lastCpu === undefined ? undefined : Math.max(0, cpu - lastCpu);
            const majorFaults = faults === undefined || lastFaults === undefined ? undefined : Math.max(0, faults - lastFaults);
            if (blocks.length < maxBlocks) {
                blocks.push({ startedAt : last, durationMs : gap, ...(cpuMs === undefined ? {} : { cpuMs }), ...(majorFaults === undefined ? {} : { majorFaults }) });
            }
        }
        last = now;
        lastCpu = cpu;
        lastFaults = faults;
    };
    const schedule = () : Timer => {
        const next = deps.setTimeout(tick, resolutionMs);
        next.unref();
        return next;
    };
    function tick() : void {
        close(deps.clock.now());
        timer = schedule();
    }
    let timer = schedule();

    return {
        span : () => {
            if (stopped) throw new Error("watchEventLoop(): span() after stop().");
            const now = deps.clock.now();
            const activity = deps.activity?.();
            close(now);
            const pauses = gc?.take();
            const timed = pauses === undefined ? blocks : blocks.map((block) => ({ ...block, gcMs : gcInside(block, pauses) }));
            const record : LoopSpan = {
                startedAt : spanStart,
                durationMs : now - spanStart,
                resolutionMs,
                limitMs,
                longestMs,
                blockCount,
                blocks : timed,
                delay : delayOf(histogram),
                busy : busyOf(activityStart, activity),
            };
            histogram.reset();
            spanStart = now;
            activityStart = activity;
            longestMs = 0;
            blockCount = 0;
            blocks = [];
            return record;
        },
        stop : () => {
            if (stopped) return;
            stopped = true;
            deps.clearTimeout(timer);
            histogram.disable();
            gc?.stop();
        },
    };
}
