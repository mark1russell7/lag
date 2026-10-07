import type { ClearIntervalFn, ClearTimeoutFn, Clock, Logger, SetIntervalFn, SetTimeoutFn } from "./types.js";

export type LagMonitorConstructor<T extends LagMonitor = LagMonitor> = new (
    ...args : ConstructorParameters<typeof LagMonitor>
) => T;

/**
 * Base class for timer-driven lag monitors.
 *
 * Subclasses start themselves at the end of their *own* constructor. The base
 * constructor must not call `start()`: with ES2022 class fields, subclass
 * field initializers run after `super()` returns and would overwrite whatever
 * state `start()` had set (e.g. the timer handle `stop()` needs to clear).
 */
export abstract class LagMonitor {
    abstract start() : void;
    abstract stop() : void;
    constructor(
        public readonly expectedElapsedTimeMs : number,
        public readonly report : (value : number) => void,

        protected readonly logger : Logger,
        protected readonly setIntervalFn : SetIntervalFn,
        protected readonly clearIntervalFn : ClearIntervalFn,
        protected readonly setTimeoutFn : SetTimeoutFn,
        protected readonly clearTimeoutFn : ClearTimeoutFn,
        protected readonly clock : Clock,
    ) {}
}
