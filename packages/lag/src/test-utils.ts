import { vi, expect, type Mock } from 'vitest';
import type { LagMonitor, LagMonitorConstructor } from "./LagMonitor.js";
import type { Meter } from "./meter.js";

/**
 * A helper class to test lag monitors with fake timers. It advances the
 * mocked time (`currentTime`) and the fake timers of Vitest together. It
 * also makes the monitor.
 */
export class LagMonitorTestDriver<T extends LagMonitor = LagMonitor> {
    public monitor?: T;
    public mockLogger = { log : vi.fn() };

    /**
     * @param getCurrentTime - A function that gives the current mocked time
     * @param setCurrentTime - A function that changes the mocked time
     * @param interval - The base measurement interval, in milliseconds
     * @param mockReport - The mock report function. It records the calls.
     */
    constructor(
        private getCurrentTime : () => number,
        private setCurrentTime : (time: number) => void,
        private readonly interval : number,
        private readonly mockReport : Mock,
    ){}

    /**
     * This method makes a lag monitor and stores it on the driver. It gives
     * the global timer functions, which Vitest fakes, to the monitor as
     * injected dependencies. It uses `getCurrentTime` as the clock.
     *
     * @param MonitorClass - The constructor of the monitor class
     * @returns The monitor that the method made
     *
     * @example
     * const monitor = driver.createMonitor(ContinuousLag);
     */
    createMonitor(MonitorClass : LagMonitorConstructor<T>) : T {
        this.monitor = new MonitorClass(
            this.interval,
            this.mockReport,
            this.mockLogger,
            setInterval,
            clearInterval,
            setTimeout,
            clearTimeout,
            { now : () => this.getCurrentTime() },
        );
        return this.monitor;
    }

    /**
     * This method advances one measurement cycle with the specified lag. It
     * advances the mocked time by `interval + lagMs`, and the timers by
     * `interval`.
     *
     * @param lagMs - The lag to simulate. A positive value is late, and a negative value is early.
     *
     * @example
     * driver.tick(5); // Simulate 5ms of lag
     * driver.tick(-2); // Simulate being 2ms ahead of schedule
     * driver.tick(0); // Perfect timing, no lag
     */
    tick(lagMs : number) : void {
        this.setCurrentTime(this.getCurrentTime() + this.interval + lagMs);
        vi.advanceTimersByTime(this.interval);
    }

    /**
     * This method advances `count` measurement cycles, each with the
     * specified lag.
     *
     * @param count - The number of cycles to advance
     * @param lagMs - The lag of each cycle
     *
     * @example
     * driver.tickMany(3, 5); // Simulate 3 cycles, each with 5ms lag
     */
    tickMany(count : number, lagMs : number) : void {
        for(let i = 0; i < count; i++) {
            this.tick(lagMs);
        }
    }

    /**
     * This method advances one cycle for each value in `lagValues`, with
     * that lag.
     *
     * @param lagValues - The lag values, one for each cycle
     * @returns The same `lagValues` array, to use in the expectations
     *
     * @example
     * const lags = driver.tickSequence([5, -2, 10]);
     * lags.forEach((lag, i) => expect(mockReport).toHaveBeenNthCalledWith(i + 1, lag));
     */
    tickSequence(lagValues : number[]) : number[] {
        lagValues.forEach(lag => this.tick(lag));
        return lagValues;
    }

    /**
     * This method asserts that the mock report got the expected lag values,
     * in sequence, and no other values.
     *
     * @param expectedLags - The expected lag values
     *
     * @example
     * driver.tickSequence([5, -2, 10]);
     * driver.expectReportedLags([5, -2, 10]);
     */
    expectReportedLags(expectedLags : number[]) : void {
        expectedLags.forEach((lag, i) => {
            expect(this.mockReport).toHaveBeenNthCalledWith(i + 1, lag);
         });
        expect(this.mockReport).toHaveBeenCalledTimes(expectedLags.length);
    }
}

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
