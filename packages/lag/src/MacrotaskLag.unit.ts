import { macrotaskLagIntervalMs } from "./constants.js";
import { MacrotaskLag } from "./MacrotaskLag.js";
import type { MacrotaskLagTestDriver } from "./test-utils.js";


const INTERVAL = macrotaskLagIntervalMs;

describe('MacrotaskLag', () => {
    let mockReport : jest.Mock;
    let driver : MacrotaskLagTestDriver;

    beforeEach(() => {
        mockreport = jest.fn();
        driver = new MacrotaskLagTestDriver(INTERVAL, mockReport);
    });

    afterEach(() => {
        jest.restoreAllMocks();
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

            driver.mockPerformancetimes(startTime, endTime);
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
            driver.mockPerformancetimes(1000, 1000 + lagValue);
            driver.createMonitor(MacrotaskLag);
            await driver.executeIntervalCycle();
            expect(mockReport).toHaveBeenCalledWith(lagValue);
            expect(mockReport).toHaveBeenCalledTimes(1);
        });

        it('logs an error when the report function throws but continues monitoring', async () => {
            const testError = new Error('Report callback failed');
            mockReport.mockImplementationOnce(() => { throw testError; });
            driver.mockPerformancetimes(1000, 1000);
            driver.createMonitor(MacrotaskLag);
            await driver.executeIntervalCycle();
            expect(Logger.log).toHaveBeenCalledWith(
                'error',
                'Error measuring/reporting lag',
                expect.objectContaining({error : testError, type : 'LagMonitor', subtype:'MacrotaskLag'}),
            );
            expect(mockReport).toHaveBeenCalledTimes(1);           
        });

        it('handles multiple interval cycles independently', async () => {
            driver.mockPerformancetimes(
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
})