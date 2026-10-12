import type { Clock, Logger } from "../types.js";
import { callbackSourceKind, type CallbackSourceKind } from "./source-kind.js";

/**
 * A callback hook, as `addCallbackHook()` of async-browser-context gets it.
 * The library starts `before` immediately before each callback that it
 * starts, and `after` immediately after the callback, also after an error.
 * Both methods operate in the context of the callback.
 */
export type CallbackHookLike = {
    before?(callback : Function, source : string) : void;
    after?(callback : Function, source : string) : void;
};

/**
 * The function that adds a callback hook and gives a function that removes
 * it: `addCallbackHook` of async-browser-context 0.2 or later.
 */
export type AddCallbackHookFn = (hook : CallbackHookLike) => () => void;

/** The default threshold: the limit of a long task. */
export const LONG_CALLBACK_THRESHOLD_MS = 50;

/** The name of a callback without a name. */
export const ANONYMOUS_CALLBACK = "(anonymous)";

/** One callback that took the threshold or more. */
export type LongCallback = {
    /**
     * The name of the callback (`callback.name`), or `"(anonymous)"`. For the
     * step of an async function after an `await`, it is the name of the
     * async function.
     */
    readonly name : string;
    /** The API that got the callback, for example `"setTimeout"`, `"addEventListener:click"` or `"await"`. */
    readonly source : string;
    /** The group of the source (refer to `callbackSourceKind`). */
    readonly sourceKind : CallbackSourceKind;
    /** The time from the start to the end of the callback, in milliseconds. */
    readonly durationMs : number;
    /** The start of the callback, in the time of the clock of the monitor. */
    readonly startTime : number;
    /** The operation of the callback from the `operation` option, or `undefined`. */
    readonly operation : string | undefined;
};

export type LongCallbackOptions = {
    /** A callback that takes this time or more is long. The default is 50 ms (`LONG_CALLBACK_THRESHOLD_MS`). */
    thresholdMs? : number;
    /**
     * A function that gives the operation of the current context, for example
     * the name of the active span (`activeSpanName(api)`) or the value of an
     * `AsyncLocalStorage`. The monitor reads it after a long callback, in the
     * context of that callback. It does not read it for a short callback.
     */
    operation? : () => string | undefined;
};

/** The name of `callback`, or `"(anonymous)"` when it has no name. */
function nameOf(callback : Function) : string {
    const name : unknown = callback.name;
    return typeof name === "string" && name !== "" ? name : ANONYMOUS_CALLBACK;
}

/**
 * This monitor measures each callback that a callback hook gives, for
 * example each callback of async-browser-context. For each callback of the
 * threshold or more, it gives a `LongCallback` to `report`. The report has
 * the name of the callback, its source, its duration, its start and its
 * operation.
 *
 * `before` puts the time of the clock on a stack, and `after` takes it from
 * the stack. A callback can start other callbacks synchronously, for example
 * with `dispatchEvent()`. The hook starts their methods between the methods
 * of the first callback, thus each callback gets its own start. The time of a
 * callback includes the time of the callbacks that it starts synchronously.
 *
 * The constructor adds the hook. `stop()` removes it.
 */
export class LongCallbackMonitor {
    /** The starts of the open callbacks: the innermost callback is the last. */
    // Stryker disable next-line ArrayDeclaration: an equivalent mutant. Only an `after` without a `before` can read a first element, and its duration is not a number.
    private readonly starts : number[] = [];
    private readonly thresholdMs : number;
    private readonly operation : (() => string | undefined) | undefined;
    private removeHook : (() => void) | undefined;
    private operationFailed = false;

    constructor(
        addCallbackHook : AddCallbackHookFn,
        private readonly report : (callback : LongCallback) => void,
        clock : Clock,
        private readonly logger : Logger,
        options : LongCallbackOptions = {},
    ) {
        this.thresholdMs = options.thresholdMs ?? LONG_CALLBACK_THRESHOLD_MS;
        this.operation = options.operation;
        // The hook operates around each callback of the page. For a short callback, it only reads
        // the clock two times and uses the stack: no allocation, no name and no source kind.
        const starts = this.starts;
        this.removeHook = addCallbackHook({
            before : () => {
                if (this.removeHook) starts.push(clock.now());
            },
            after : (callback, source) => {
                // An `after` without a `before` (the callback started before the hook was added, or before
                // stop()) has no start. Its duration is -Infinity, thus the monitor does not report it.
                const startTime = starts.pop() ?? Infinity;
                const durationMs = clock.now() - startTime;
                if (durationMs >= this.thresholdMs) this.record(callback, source, startTime, durationMs);
            },
        });
    }

    /** True until `stop()`. */
    get running() : boolean {
        return this.removeHook !== undefined;
    }

    /**
     * This method removes the hook. The library can still start `after` for
     * the callbacks that started before, and the monitor ignores these calls.
     */
    stop() : void {
        this.removeHook?.();
        this.removeHook = undefined;
        this.starts.length = 0;
    }

    /** This method reports one long callback. Only a long callback gets its name, its source kind and its operation. */
    private record(callback : Function, source : string, startTime : number, durationMs : number) : void {
        try {
            this.report({
                name : nameOf(callback),
                source,
                sourceKind : callbackSourceKind(source),
                durationMs,
                startTime,
                operation : this.readOperation(),
            });
        } catch (error) {
            this.logger.log("error", "Error reporting a long callback.", { error, monitor : "long-callbacks" });
        }
    }

    /** The operation of the current context. An error of the function gives `undefined`, and one warning. */
    private readOperation() : string | undefined {
        if (!this.operation) return undefined;
        try {
            const operation = this.operation();
            return typeof operation === "string" && operation !== "" ? operation : undefined;
        } catch (error) {
            if (!this.operationFailed) {
                this.operationFailed = true;
                this.logger.log("warn", "The operation function of the long callback monitor failed.", { error, monitor : "long-callbacks" });
            }
            return undefined;
        }
    }
}
