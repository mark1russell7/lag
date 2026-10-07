import { vi, expect, type Mock } from 'vitest';
import type { LagMonitor, LagMonitorConstructor } from "./LagMonitor.js";
import type { Meter } from "./meter.js";

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
    values : RecordedValue[];
};

/**
 * This function makes a `Meter` that records each histogram and counter
 * value, with the `kind` and the `unit` of its instrument.
 */
export function createRecordingMeter() {
    const instruments = new Map<string, RecordedInstrument>();

    const recorder = (name : string, kind : RecordedInstrument["kind"], unit : string) => {
        const instrument : RecordedInstrument = { name, kind, unit, values : [] };
        instruments.set(name, instrument);
        return (value : number, attributes? : unknown) => {
            instrument.values.push({ value, attributes : attributes as Record<string, unknown> | undefined });
        };
    };

    const meter : Meter = {
        createHistogram : (name, options) => ({ record : recorder(name, "histogram", options.unit) }),
        createCounter : (name, options) => ({ add : recorder(name, "counter", options.unit) }),
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
