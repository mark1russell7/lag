import type { LagMonitorConstructor } from "./LagMonitor.js";

/**
 * Helper class for testing lag monitors with fake timers.
 * Simplifies the common pattern of advancing both actual time (currentTime)
 * and Jest's fake timers in sync and automatically create the monitor.
 * 
 */
export class LagMonitorTestDriver<T = unknown> {
    public monitor?: T;

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
        private readonly mockReport : jest.Mock,
    ){}

    /**
     * Creates a lag monitor instance and stores it on the driver.
     * 
     * @param MonitorClass - The monitor class constructor
     * @returns The created monitor instance
     * 
     * @example
     * const monitor = driver.createMonitor(ContinuousLag);
     */
    createMonitor<M>(MonitorClass : LagMonitorConstructor<M>) : M {
        this.monitor = new MonitorClass(
            this.interval,
            this.mockReport
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
     * driver.tick(-2); // Simulate beng 2ms ahead of schedule
     * driver.tick(0); // Perfect timing, no lag    
     */
    tick(lagMs : number) : void {
        this.setCurrentTime(this.getCurrentTime() + this.interval + lagMs);
        jest.advanceTimersByTime(this.interval);
    }

    /**
     * Advances multiple measurement cycles, each with the spceified lag.
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
        expect(this.mockReport).toHaveBeenCalledtimes(expectedLags.length);
    }
}

/**
 * Test utlity for MacrotaskLag that handles the async callback coordination
 * between setInterval and setTimeout(0) calls
 */
export class MacrotaskLagTestDriver {
    private setIntervalSpy : jest.SpyInstance;
    private setTimeoutSpy : jest.SpyInstance;
    private performanceNowSpy : jest.SpyInstance;
    private timeoutCallCount = 0;


    constructor(
        public readonly intervalMs : number,
        public readonly mockReport : jest.Mock
    ) {
        this.setIntervalSpy = jest.spyOn(global, 'setInterval').mockImplementation(() => 123);
        this.setTimeoutSpy = jest.spyOn(global, 'setTimeout').mockImplementation(() => 456);
        this.performanceNowSpy = jest.spyOn(this.performanceNowSpy, 'now');
    }

    /** 
     * Creats a MacrotaskLag monitor instance
    */
   createMonitor<M>(MonitorClass : LagMonitorConstructor<M>) : M {
        return new MonitorClass(
            this.intervalMs,
            this.mockReport,

        )
   }

   /**
    * Mock performance.now( to return a sequence of values.
    * Useful for simulating the passage of time in tests.
    */
    mockPerformancetimes(...times : number[]) : void {
        times.forEach((time) => this.performanceNowSpy.mockReturnValueOnce(time));
    }

    /**
     * Executes one complete interval cycle: calls the interval callback,
     * executes the setTimeout(0) callback, and awaits the results.
     */
    async executeIntervalCycle():Promise<void> {
        const intervalCallback = this.setIntervalSpy.mock.calls[0][0];
        const promise = intervalCallback();
        const timeoutCallback = this.setTimeoutSpy.mock.calls[this.timeoutCallCount][0];
        this.timeoutCallCount++;
        timeoutCallback();
        await promise;
    }

    /**
     * Gets the interval callback function for manual execution.
     */
    getIntervalCallback() : () => Promise<void> {
        return this.setIntervalSpy.mock.calls[0][0];
    }

    /**
     * Gets a specific setTimeout callback by index
     */
    getTimeoutCallback(index : number = 0) : () => void {
        return this.setTimeoutSpy.mock.calls[index][0];
    }

    /**
     * Asserts that setInterval was called with the correct interval.
     */
    expectIntervalSetup(): void {
        expect(this.setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), this.intervalMs);
        expect(this.setIntervalSpy).toHaveBeenCalledTimes(1);

    }

    /**
     * Asserts that setTimeout was called with the specified delay.
     */
    expectTimeoutScheduled(delay: number = 0): void {
        expect(this.setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), delay);
    }
}
