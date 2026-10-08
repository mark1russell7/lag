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

export type PerformanceObserverOptions = {
    /**
     * The minimum duration of an entry that the browser reports, for Event
     * Timing only. The default of the browser is 104 ms. The smallest
     * permitted value is 16 ms.
     */
    durationThreshold? : number;
};

export type PerformanceObserverInstance = {
    observe(options : PerformanceObserverOptions & { type : string; buffered? : boolean }) : void;
    disconnect() : void;
    /** This method removes and gives the entries that the browser did not deliver yet. */
    takeRecords?() : PerformanceEntryLike[];
};

export type PerformanceObserverInit = {
    new (
        callback : (list : PerformanceEntryList, observer : PerformanceObserverInstance) => void,
    ) : PerformanceObserverInstance;
    /**
     * The entry types that the browser supports. In `observe()`, browsers
     * ignore a type that they do not support, and they show only a warning
     * in the console. Thus, this list is the reliable check.
     */
    readonly supportedEntryTypes? : readonly string[];
};

// --- Long Animation Frame ---

export type LoafScriptEntry = {
    name : string;
    invoker : string;
    invokerType : string;
    startTime : number;
    executionStart : number;
    duration : number;
    forcedStyleAndLayoutDuration : number;
    /** The time that the script spent in synchronous pauses, for example in `alert()`. */
    pauseDuration? : number;
    sourceURL : string;
    sourceFunctionName? : string;
    sourceCharPosition? : number;
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
