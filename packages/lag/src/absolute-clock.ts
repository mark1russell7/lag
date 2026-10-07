import type { PerformanceLike } from "./types.js";

/**
 * The absolute time of one JavaScript context, in Unix milliseconds:
 * `performance.timeOrigin` (read one time) plus `performance.now()`.
 *
 * Read `timeOrigin` only one time. Safari calculates it again from the wall
 * clock at each read, thus a later read can jump when the wall clock
 * changes. With one read, the absolute time of each context moves with its
 * monotonic clock only, in all browsers.
 */
export type AbsoluteClock = {
    /** The `timeOrigin` value at the time of construction. */
    readonly origin : number;
    /** `origin + performance.now()`. */
    now() : number;
    /** `performance.now()`: the monotonic time from the origin. */
    monotonic() : number;
};

export function createAbsoluteClock(performance : PerformanceLike) : AbsoluteClock {
    const origin = performance.timeOrigin;
    return {
        origin,
        now : () => origin + performance.now(),
        monotonic : () => performance.now(),
    };
}
