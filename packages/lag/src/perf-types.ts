// Duck-typed Performance API types — no DOM lib dependency.
// Structural typing allows these to match the real browser APIs.

export type PerformanceEntryLike = {
    entryType : string;
    name : string;
    startTime : number;
    duration : number;
};

export type PerformanceEntryList = {
    getEntries() : PerformanceEntryLike[];
};

export type PerformanceObserverInstance = {
    observe(options : { type : string; buffered? : boolean }) : void;
    disconnect() : void;
};

export type PerformanceObserverInit = new (
    callback : (list : PerformanceEntryList, observer : PerformanceObserverInstance) => void,
) => PerformanceObserverInstance;

// --- Long Animation Frame ---

export type LoafScriptEntry = {
    name : string;
    invoker : string;
    invokerType : string;
    startTime : number;
    executionStart : number;
    duration : number;
    forcedStyleAndLayoutDuration : number;
    sourceURL : string;
};

export type LoafEntry = PerformanceEntryLike & {
    entryType : "long-animation-frame";
    blockingDuration : number;
    renderStart : number;
    styleAndLayoutStart : number;
    scripts : LoafScriptEntry[];
};

// --- Event Timing ---

export type EventTimingEntry = PerformanceEntryLike & {
    entryType : "event";
    processingStart : number;
    processingEnd : number;
    interactionId : number;
    cancelable : boolean;
};

// --- Layout Shift ---

export type LayoutShiftSource = {
    node : unknown;
    previousRect : { x : number; y : number; width : number; height : number };
    currentRect : { x : number; y : number; width : number; height : number };
};

export type LayoutShiftEntry = PerformanceEntryLike & {
    entryType : "layout-shift";
    value : number;
    hadRecentInput : boolean;
    lastInputTime : number;
    sources : LayoutShiftSource[];
};
