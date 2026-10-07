export type Logger = {
    log(level : string, message : string, args : unknown) : void;
};

export type SetTimeoutFn = (handler : () => void, timeout : number) => number;

export type ClearTimeoutFn = (handle : number) => void;

export type SetIntervalFn = (handler : () => void, timeout : number) => number;

export type ClearIntervalFn = (handle : number) => void;

export type Clock = {
    now : () => number;
};

/** The subset of `window.performance` used for absolute (cross-context) timestamps. */
export type PerformanceLike = {
    now : () => number;
    timeOrigin : number;
    /** The number of user interactions on the page (Chromium 144 and later). */
    readonly interactionCount? : number;
};

/** The wall clock (`Date.now()`). It can jump when the system clock changes. */
export type WallClock = {
    now : () => number;
};

export type LagMeasurement = {
    value : number;
    attributes : EventLoopLagAttributes;
};

export type EventLoopLagAttributes = {
    wasHidden : boolean;
    [key : string] : unknown;
};
