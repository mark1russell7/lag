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
    /** Event Timing only: minimum entry duration to report (browser default 104ms, minimum 16ms). */
    durationThreshold? : number;
};

export type PerformanceObserverInstance = {
    observe(options : PerformanceObserverOptions & { type : string; buffered? : boolean }) : void;
    disconnect() : void;
    /** Removes and gives the entries that the browser has not delivered yet. */
    takeRecords?() : PerformanceEntryLike[];
};

export type PerformanceObserverInit = {
    new (
        callback : (list : PerformanceEntryList, observer : PerformanceObserverInstance) => void,
    ) : PerformanceObserverInstance;
    /**
     * Entry types this browser supports. Browsers ignore unsupported types in
     * `observe()` with only a console warning, so this is the reliable check.
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
    /** Time the script spent in synchronous pauses such as `alert()`. */
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
