import {
    createBrowserDeps as createCoreBrowserDeps,
    type AllMonitorDeps,
    type Attributes,
    type BrowserDepsOptions,
    type Logger,
    type Meter,
} from "@lag/core";

/** Block the main thread synchronously for `ms` milliseconds. */
export function blockMainThread(ms : number) : void {
    const start = performance.now();
    while (performance.now() - start < ms) {
        // busy wait
    }
}

/** Wait for real time to pass. */
export function wait(ms : number) : Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export type TeeMeter = {
    meter : Meter;
    /** Every value recorded so far by the named histogram or counter. */
    values(name : string) : number[];
    max(name : string) : number;
    /** Total values recorded across all instruments. */
    totalRecords() : number;
};

/**
 * This function wraps a real OTel meter, so that the tests can examine the
 * recorded values. The values also go to the exporter.
 */
export function createTeeMeter(inner : Meter) : TeeMeter {
    const recorded = new Map<string, number[]>();
    const sink = (name : string) : number[] => {
        const values : number[] = [];
        recorded.set(name, values);
        return values;
    };

    const meter : Meter = {
        createHistogram<A extends Attributes>(name : string, options : { unit : string }) {
            const histogram = inner.createHistogram<A>(name, options);
            const values = sink(name);
            return {
                record(value : number, attributes? : A) {
                    values.push(value);
                    histogram.record(value, attributes);
                },
            };
        },
        createCounter<A extends Attributes>(name : string, options : { unit : string }) {
            const counter = inner.createCounter<A>(name, options);
            const values = sink(name);
            return {
                add(value : number, attributes? : A) {
                    values.push(value);
                    counter.add(value, attributes);
                },
            };
        },
    };

    return {
        meter,
        values : (name) => recorded.get(name) ?? [],
        max : (name) => Math.max(0, ...(recorded.get(name) ?? [])),
        totalRecords : () => [...recorded.values()].reduce((n, values) => n + values.length, 0),
    };
}

export function createConsoleLogger(levels : readonly string[] = ["trace", "debug", "info", "warn", "error"]) : Logger {
    return {
        log(level, message, args) {
            if (levels.includes(level)) console.log(`[${level}] ${message}`, args);
        },
    };
}

/**
 * setupAllMonitors deps backed by the real browser APIs, through the core
 * browser adapter. Thus the tests also examine the adapter in each browser.
 */
export function createBrowserDeps(options : BrowserDepsOptions) : AllMonitorDeps {
    return createCoreBrowserDeps(window, options);
}
