import type { Mock } from 'vitest';
import { macrotaskLagIntervalMs } from "./constants.js";
import { MacrotaskLag } from "./MacrotaskLag.js";
import { SimulatedThread } from "./test-thread.js";
import { MacrotaskLagTestDriver } from "./test-utils.js";


const INTERVAL = macrotaskLagIntervalMs;

/** The report of a sample comes in a microtask after the timeout callback. */
async function flushPromises() : Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('MacrotaskLag', () => {
    let mockReport : Mock;
    let driver : MacrotaskLagTestDriver;

    beforeEach(() => {
        mockReport = vi.fn();
        driver = new MacrotaskLagTestDriver(INTERVAL, mockReport);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('constructor', () => {
        it('sets up an interval with the specified period', () => {
            driver.createMonitor(MacrotaskLag);
            driver.expectIntervalSetup();
        })
    });

    describe('measure()', () => {
        it('returns a promise that resolves with the macrotask schedulng delay', async () => {
            const startTime = 1000;
            const endTime = 1010;

            driver.mockPerformanceTimes(startTime, endTime);
            const macrotaskLag = driver.createMonitor(MacrotaskLag);
            const measurePromise = macrotaskLag.measure();
            const timeoutCallback = driver.getTimeoutCallback(0);
            timeoutCallback();
            const lag = await measurePromise;
            expect(lag).toBe(10);
        });

        it('schedules a macrotask with zero delay to measure event loop lag', () => {
            const macrotaskLag = driver.createMonitor(MacrotaskLag);
            void macrotaskLag.measure();
            driver.expectTimeoutScheduled(0);
        });
    });

    describe('interval callback', () => {
        it('measures and reports lag value when interval fires', async () => {
            const lagValue = 15;
            driver.mockPerformanceTimes(1000, 1000 + lagValue);
            driver.createMonitor(MacrotaskLag);
            await driver.executeIntervalCycle();
            expect(mockReport).toHaveBeenCalledWith(lagValue);
            expect(mockReport).toHaveBeenCalledTimes(1);
        });

        it('logs an error when the report function throws but continues monitoring', async () => {
            const testError = new Error('Report callback failed');
            mockReport.mockImplementationOnce(() => { throw testError; });
            driver.mockPerformanceTimes(1000, 1000);
            driver.createMonitor(MacrotaskLag);
            await driver.executeIntervalCycle();
            expect(driver.mockLogger.log).toHaveBeenCalledWith(
                'error',
                'Error measuring/reporting lag.',
                expect.objectContaining({ error : testError, type : 'LagMonitor', subtype : 'MacrotaskLag' }),
            );
            expect(mockReport).toHaveBeenCalledTimes(1);
        });

        it('handles multiple interval cycles independently', async () => {
            driver.mockPerformanceTimes(
                1000,
                1005, // First cycle: 5ms lag
                2000,
                2020 // Second cycle: 20ms lag
            );

            driver.createMonitor(MacrotaskLag);

            await driver.executeIntervalCycle();
            expect(mockReport).toHaveBeenCalledWith(5);

            await driver.executeIntervalCycle();
            expect(mockReport).toHaveBeenCalledWith(20);

            expect(mockReport).toHaveBeenCalledTimes(2);
        });
    })

    describe('stop()', () => {
        it('clears the interval it created in the constructor', () => {
            const monitor = driver.createMonitor(MacrotaskLag);
            monitor.stop();
            expect(driver.mockClearInterval).toHaveBeenCalledWith(123);
        });

        it('drops a sample that was in flight when stop() was called', async () => {
            driver.mockPerformanceTimes(1000, 1010);
            const monitor = driver.createMonitor(MacrotaskLag);

            driver.getIntervalCallback()();
            monitor.stop();
            driver.getTimeoutCallback(0)();
            await Promise.resolve();
            await Promise.resolve();

            expect(mockReport).not.toHaveBeenCalled();
        });

        // This test found a library bug. The monitor checked only that it operated when the sample
        // ended. Thus after stop() and start(), it reported the sample of 300 ms from before the stop.
        it('drops a sample that was in flight across stop() and start()', async () => {
            const thread = new SimulatedThread();
            const report = vi.fn();
            const monitor = new MacrotaskLag(
                1_000, report, { log : vi.fn() },
                thread.setInterval, thread.clearInterval, thread.setTimeout, thread.clearTimeout, thread.clock,
                thread.post,
            );
            // The interval posts the measurement. A task of 300 ms waits before the timeout of the
            // measurement, and the page is hidden and visible again in that task.
            thread.advance(1_000);
            thread.post(() => {
                thread.busy(300);
                monitor.stop();
                monitor.start();
            });
            thread.advance(400);
            await flushPromises();
            expect(report).not.toHaveBeenCalled();

            // The next sample after the start reports
            thread.advance(1_000);
            await flushPromises();
            expect(report).toHaveBeenCalledTimes(1);
            expect(report.mock.calls[0]![0]).toBeLessThan(1);
            monitor.stop();
        });

        it('start() while the monitor operates adds no second interval', () => {
            driver.createMonitor(MacrotaskLag).start();

            driver.expectIntervalSetup();
        });

        it('can be restarted', () => {
            const monitor = driver.createMonitor(MacrotaskLag);
            monitor.stop();
            monitor.start();
            expect(driver.mockSetInterval).toHaveBeenCalledTimes(2);
        });
    });

    describe('postTask', () => {
        it('starts the measurement in the posted task, so that the timer nesting clamp does not apply', async () => {
            const posted : Array<() => void> = [];
            const clock = { now : vi.fn() };
            clock.now.mockReturnValueOnce(2_000).mockReturnValueOnce(2_003);
            const setTimeoutFn = vi.fn().mockReturnValue(7);
            const setIntervalFn = vi.fn().mockReturnValue(1);
            new MacrotaskLag(
                INTERVAL, mockReport, { log : vi.fn() },
                setIntervalFn, vi.fn(), setTimeoutFn, vi.fn(), clock,
                (callback) => posted.push(callback),
            );

            void setIntervalFn.mock.calls[0]![0]();
            // The interval callback only posts the task
            expect(setTimeoutFn).not.toHaveBeenCalled();
            posted[0]!();
            expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 0);
            setTimeoutFn.mock.calls[0]![0]();
            await Promise.resolve();
            await Promise.resolve();

            expect(mockReport).toHaveBeenCalledWith(3);
        });
    });
});
