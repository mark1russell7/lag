import { vi, expect, type Mock } from 'vitest';
import type { LagMonitor, LagMonitorConstructor } from "./LagMonitor.js";

/**
 * Helper class for testing lag monitors with fake timers.
 * Simplifies the common pattern of advancing both actual time (currentTime)
 * and vitest's fake timers in sync and automatically create the monitor.
 *
 */
export class LagMonitorTestDriver<T extends LagMonitor = LagMonitor> {
    public monitor?: T;
    public mockLogger = { log : vi.fn() };

    /**
     * @param getCurrentTime - Function that returns the current mocked time
     * @param setCurrentTime - Function to update the mocked time
     * @param interval - The base measurement interval in milliseconds
     * @param mockReport - The mock report function to track calls
     */
    constructor(
        private getCurrentTime : () => number,
        private setCurrentTime : (time: number) => void,
        private readonly interval : number,
        private readonly mockReport : Mock,
    ){}

    /**
     * Creates a lag monitor instance and stores it on the driver.
     * Passes vitest-faked globals as DI'd timer functions, and wraps
     * getCurrentTime as the clock.
     *
     * @param MonitorClass - The monitor class constructor
     * @returns The created monitor instance
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
     * Advances one measurement cycle with the specified lag.
     * Advances actual time by (interval + lagMs) and timers by interval.
     *
     * @param lagMs - The amount of lag to simulate (positive = behind, negative = ahead)
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
     * Advances multiple measurement cycles, each with the specified lag.
     *
     * @param count - Number of cycles to advance
     * @param lagMs - The amount of lag per cycle
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
     * Advances multiple cycles with different lag values for each cycle.
     *
     * @param lagValues - Array of lag values, one per cycle
     * @returns The lag values array (for chaining with expectations)
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
     * Asserts that the mock report was called with the expected lag values in sequence.
     *
     * @param expectedLags - Array of expected lag values
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
 * Test utility for MacrotaskLag that handles the async callback coordination
 * between setInterval and setTimeout(0) calls.
 * Uses vi.fn() mocks rather than global spies since MacrotaskLag
 * receives its timer functions via DI.
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
     * Creates a MacrotaskLag monitor instance
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
    * Mock clock.now() to return a sequence of values.
    * Useful for simulating the passage of time in tests.
    */
    mockPerformanceTimes(...times : number[]) : void {
        times.forEach((time) => this.mockClock.now.mockReturnValueOnce(time));
    }

    /**
     * Executes one complete interval cycle: calls the interval callback,
     * executes the setTimeout(0) callback, and awaits the results.
     */
    async executeIntervalCycle():Promise<void> {
        const intervalCallback = this.mockSetInterval.mock.calls[0][0];
        const promise = intervalCallback();
        const timeoutCallback = this.mockSetTimeout.mock.calls[this.timeoutCallCount][0];
        this.timeoutCallCount++;
        timeoutCallback();
        await promise;
        // Extra flush: Vitest/V8 needs one more microtask hop than Jest
        // for the async measure() wrapper to resolve before assertions
        await Promise.resolve();
    }

    /**
     * Gets the interval callback function for manual execution.
     */
    getIntervalCallback() : () => Promise<void> {
        return this.mockSetInterval.mock.calls[0][0];
    }

    /**
     * Gets a specific setTimeout callback by index
     */
    getTimeoutCallback(index : number = 0) : () => void {
        return this.mockSetTimeout.mock.calls[index][0];
    }

    /**
     * Asserts that setInterval was called with the correct interval.
     */
    expectIntervalSetup(): void {
        expect(this.mockSetInterval).toHaveBeenCalledWith(expect.any(Function), this.intervalMs);
        expect(this.mockSetInterval).toHaveBeenCalledTimes(1);

    }

    /**
     * Asserts that setTimeout was called with the specified delay.
     */
    expectTimeoutScheduled(delay: number = 0): void {
        expect(this.mockSetTimeout).toHaveBeenCalledWith(expect.any(Function), delay);
    }
}
