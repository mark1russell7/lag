import type { ClearIntervalFn, Clock, Logger, SetIntervalFn, SetTimeoutFn } from "./types.js";

export type LagMonitorConstructor<T extends LagMonitor = LagMonitor> = new (
    ...args : ConstructorParameters<typeof LagMonitor>
) => T;

export abstract class LagMonitor {
    abstract start() : void;
    abstract stop() : void;
    constructor(
        public expectedElapsedTimeMs : number,
        public report : (value: number) => void,

        protected logger : Logger,
        protected setIntervalFn : SetIntervalFn,
        protected clearIntervalFn : ClearIntervalFn,
        protected setTimeoutFn : SetTimeoutFn,
        protected clearTimeoutFn : ClearIntervalFn,
        protected clock : Clock
    ) {
        this.start();
    }
}