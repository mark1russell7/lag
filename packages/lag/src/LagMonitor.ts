import type { ClearIntervalFn, ClearTimeoutFn, Clock, Logger, SetIntervalFn, SetTimeoutFn } from "./types.js";

export type LagMonitorConstructor<T extends LagMonitor = LagMonitor> = new (
    ...args : ConstructorParameters<typeof LagMonitor>
) => T;

/**
 * The base class of the timer-driven lag monitors.
 *
 * Each subclass starts itself at the end of its *own* constructor. The base
 * constructor must not start the monitor. With ES2022 class fields, a
 * subclass initializes its fields after `super()`. Thus, the field
 * initializers replace the state that `start()` set, for example the timer
 * handle that `stop()` must clear.
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
