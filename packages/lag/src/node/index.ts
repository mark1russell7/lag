/**
 * The entry `@mark1russell7/lag/node`: the watch of the event loop of Node.js. It is the only entry of the package
 * that imports a `node:` module. The other entries get no Node.js types (`tsconfig.json`), thus their build fails on
 * such an import.
 *
 * - `watchEventLoop()` gives a record of each span. The record has the histogram of `monitorEventLoopDelay` and the
 *   longest gap of the timer of the watch. It also has each block over a limit with its start, and the busy part of the loop.
 * - The block records have the shape of the browser monitors (`startedAt`, `durationMs`). On Node.js, each block also has the
 *   CPU time of the thread and the pause time of the garbage collector inside it.
 */
export {
    EVENT_LOOP_BLOCK_LIMIT_MS,
    EVENT_LOOP_MAX_BLOCKS,
    EVENT_LOOP_RESOLUTION_MS,
    watchEventLoop,
    type DelayHistogram,
    type EventLoopWatch,
    type EventLoopWatchDeps,
    type EventLoopWatchOptions,
    type GcPause,
    type GcPauses,
    type LoopActivity,
    type LoopBlock,
    type LoopBusy,
    type LoopDelay,
    type LoopSpan,
    type NodeTimer,
} from "./event-loop.js";
