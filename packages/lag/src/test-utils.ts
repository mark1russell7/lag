import { vi, expect, type Mock } from 'vitest';
import type { LagMonitor, LagMonitorConstructor } from "./LagMonitor.js";
import type { InstrumentAdvice, Meter } from "./meter.js";
import { EVENT_CATALOG, METRIC_CATALOG, SPAN_CATALOG } from "./metric-catalog.js";
import type { SpanIdentity, SpanOptions, SpanSink } from "./spans.js";

/**
 * A test utility for `MacrotaskLag`. It controls the order of the
 * asynchronous callbacks of `setInterval` and `setTimeout(0)`. It uses
 * `vi.fn()` mocks, not global spies, because `MacrotaskLag` gets its timer
 * functions through dependency injection.
 */
export class MacrotaskLagTestDriver {
    public mockSetInterval = vi.fn().mockReturnValue(123);
    public mockSetTimeout = vi.fn().mockReturnValue(456);
    public mockClearInterval = vi.fn();
    public mockClearTimeout = vi.fn();
    public mockClock = { now : vi.fn() };
    public mockLogger = { log : vi.fn() };
    private timeoutCallCount = 0;


    constructor(
        public readonly intervalMs : number,
        public readonly mockReport : Mock
    ) {}

    /**
     * This method makes a monitor of `MonitorClass` with the mocks of the driver.
    */
   createMonitor<M extends LagMonitor>(MonitorClass : LagMonitorConstructor<M>) : M {
        return new MonitorClass(
            this.intervalMs,
            this.mockReport,
            this.mockLogger,
            this.mockSetInterval,
            this.mockClearInterval,
            this.mockSetTimeout,
            this.mockClearTimeout,
            this.mockClock,
        )
   }

   /**
    * This method makes `clock.now()` give a sequence of values. Use it to
    * simulate the passage of time in tests.
    */
    mockPerformanceTimes(...times : number[]) : void {
        times.forEach((time) => this.mockClock.now.mockReturnValueOnce(time));
    }

    /**
     * This method does one full interval cycle. It starts the interval
     * callback, then the `setTimeout(0)` callback, and waits for the results.
     */
    async executeIntervalCycle():Promise<void> {
        const intervalCallback = this.mockSetInterval.mock.calls[0]![0];
        const promise = intervalCallback();
        const timeoutCallback = this.mockSetTimeout.mock.calls[this.timeoutCallCount]![0];
        this.timeoutCallCount++;
        timeoutCallback();
        await promise;
        // Extra flush: Vitest/V8 needs one more microtask hop than Jest
        // for the async measure() wrapper to resolve before assertions
        await Promise.resolve();
    }

    /**
     * This method gives the interval callback, so that a test can start it.
     */
    getIntervalCallback() : () => Promise<void> {
        return this.mockSetInterval.mock.calls[0]![0];
    }

    /**
     * This method gives the `setTimeout` callback at `index`.
     */
    getTimeoutCallback(index : number = 0) : () => void {
        return this.mockSetTimeout.mock.calls[index]![0];
    }

    /**
     * This method asserts that the monitor used `setInterval` one time, with
     * the correct interval.
     */
    expectIntervalSetup(): void {
        expect(this.mockSetInterval).toHaveBeenCalledWith(expect.any(Function), this.intervalMs);
        expect(this.mockSetInterval).toHaveBeenCalledTimes(1);

    }

    /**
     * This method asserts that the monitor used `setTimeout` with the
     * specified delay.
     */
    expectTimeoutScheduled(delay: number = 0): void {
        expect(this.mockSetTimeout).toHaveBeenCalledWith(expect.any(Function), delay);
    }
}

export type RecordedValue = { value : number; attributes : Record<string, unknown> | undefined };

export type RecordedInstrument = {
    name : string;
    kind : "histogram" | "counter";
    unit : string;
    /** The advice of the first instrument with this name. */
    advice : InstrumentAdvice | undefined;
    values : RecordedValue[];
};

/**
 * This function makes a `Meter` that records each histogram and counter
 * value, with the `kind`, the `unit` and the advice of its instrument.
 */
export function createRecordingMeter() {
    const instruments = new Map<string, RecordedInstrument>();

    // Two instruments with the same name share their values, as in the OpenTelemetry SDK. For
    // example, the worker monitor and the peer hang watch both record lag_main_thread_hangs.
    const recorder = (name : string, kind : RecordedInstrument["kind"], unit : string, advice : InstrumentAdvice | undefined) => {
        const instrument : RecordedInstrument = instruments.get(name) ?? { name, kind, unit, advice, values : [] };
        instruments.set(name, instrument);
        return (value : number, attributes? : unknown) => {
            instrument.values.push({ value, attributes : attributes as Record<string, unknown> | undefined });
        };
    };

    const meter : Meter = {
        createHistogram : (name, options) => ({ record : recorder(name, "histogram", options.unit, options.advice) }),
        createCounter : (name, options) => ({ add : recorder(name, "counter", options.unit, options.advice) }),
    };

    return {
        meter,
        /** All values that the named histogram or counter recorded. */
        values : (name : string) : number[] => (instruments.get(name)?.values ?? []).map(r => r.value),
        /** The sum of the values of the named counter. */
        sum : (name : string) : number => (instruments.get(name)?.values ?? []).reduce((n, r) => n + r.value, 0),
        /** All records, by instrument name. */
        records : () : ReadonlyMap<string, readonly RecordedValue[]> =>
            new Map([...instruments].map(([name, i]) => [name, i.values])),
        /** All instruments that the meter made. */
        instruments : () : readonly RecordedInstrument[] => [...instruments.values()],
    };
}

/**
 * This function makes sure that the meter made only instruments of the metric
 * catalog. Each instrument must have the kind, the unit and the bucket
 * boundaries of the catalog. Each recorded attribute must have a value that
 * the catalog permits.
 */
export function expectCatalogInstruments(recording : ReturnType<typeof createRecordingMeter>) : void {
    const byName = new Map(METRIC_CATALOG.map(m => [m.name, m]));
    for (const instrument of recording.instruments()) {
        const definition = byName.get(instrument.name);
        expect(definition, instrument.name).toBeDefined();
        expect(instrument.kind, instrument.name).toBe(definition!.kind);
        expect(instrument.unit, instrument.name).toBe(definition!.unit);
        expect(instrument.advice?.explicitBucketBoundaries, instrument.name).toEqual(definition!.advice?.explicitBucketBoundaries);
        for (const { attributes } of instrument.values) {
            for (const [key, value] of Object.entries(attributes ?? {})) {
                expect(definition!.attributes[key], `${instrument.name}.${key}=${String(value)}`).toContain(value);
            }
        }
    }
}

/**
 * This function makes sure that each event that `emit` got has a name of the
 * event catalog. Each attribute name of the event must be in its catalog
 * entry. A catalog name that ends with `.*` permits each name with that
 * prefix. The names in `contextAttributes` are permitted for each event.
 */
export function expectCatalogEvents(emit : Mock, contextAttributes : readonly string[] = []) : void {
    const byName = new Map(EVENT_CATALOG.map(e => [e.name, e]));
    for (const [name, attributes] of emit.mock.calls as Array<[string, Record<string, unknown>]>) {
        const definition = byName.get(name);
        expect(definition, name).toBeDefined();
        for (const key of Object.keys(attributes)) {
            const listed = contextAttributes.includes(key)
                || definition!.attributes.some(a => a === key || (a.endsWith(".*") && key.startsWith(a.slice(0, -1))));
            expect(listed, `${name}: ${key}`).toBe(true);
        }
    }
}

/** A span that the recording span sink got. `endTime` is undefined while the span is open. */
export type RecordedSpan = {
    name : string;
    identity : SpanIdentity;
    startTime : number;
    endTime : number | undefined;
    attributes : Record<string, unknown>;
    parent : SpanIdentity | undefined;
    links : readonly SpanIdentity[];
};

/**
 * A span sink that records each span. Each span gets a new valid identity.
 * A span with a parent is in the trace of the parent.
 */
export function createRecordingSpanSink() : SpanSink & { spans : RecordedSpan[]; named(name : string) : RecordedSpan[] } {
    let next = 1;
    const spans : RecordedSpan[] = [];
    const add = (name : string, options : SpanOptions, endTime : number | undefined) : RecordedSpan => {
        const n = next++;
        const span : RecordedSpan = {
            name,
            identity : { traceId : options.parent?.traceId ?? n.toString(16).padStart(32, "0"), spanId : n.toString(16).padStart(16, "0") },
            startTime : options.startTime,
            endTime,
            attributes : { ...options.attributes },
            parent : options.parent,
            links : options.links ?? [],
        };
        spans.push(span);
        return span;
    };
    return {
        spans,
        named : (name) => spans.filter(span => span.name === name),
        start(name, options) {
            const span = add(name, options, undefined);
            return {
                identity : span.identity,
                setAttributes : (attributes) => { Object.assign(span.attributes, attributes); },
                end : (endTime) => { if (span.endTime === undefined) span.endTime = endTime; },
            };
        },
        record(name, options) {
            add(name, options, options.endTime);
        },
    };
}

/** This function makes sure that each recorded span has a name and attributes of the span catalog. */
export function expectCatalogSpans(spans : readonly RecordedSpan[]) : void {
    const byName = new Map(SPAN_CATALOG.map(definition => [definition.name, definition]));
    for (const span of spans) {
        const definition = byName.get(span.name);
        expect(definition, span.name).toBeDefined();
        for (const key of Object.keys(span.attributes)) {
            const allowed = definition!.attributes.some(name => name === key || (name.endsWith("*") && key.startsWith(name.slice(0, -1))));
            expect(allowed, `${span.name}: ${key}`).toBe(true);
        }
    }
}
