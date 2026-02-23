export type Logger = {
    log : (level : string, message : string, args : any) => void
}

export type SetTimeoutFn = (handler: () => void, timeout: number) => number;

export type ClearTimeoutFn = (handle: number) => void;

export type SetIntervalFn = (handler: () => void, timeout: number) => number;

export type ClearIntervalFn = (handle: number) => void;

export type Clock = {
    now : () => number
}

export type LagMeasurement= {
    value : number;
    attributes : EventLoopLagAttributes;
}
export type EventLoopLagAttributes = {
    wasHidden : boolean;
    [key: string] : any;
}