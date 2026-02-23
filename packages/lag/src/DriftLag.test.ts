import type { Mock } from 'vitest';
import { driftStepMs, highFrequencyLagIntervalMs } from "./constants.js";
import { DriftLag } from "./DriftLag.js";
import { LagMonitorTestDriver } from "./test-utils.js";


const INTERVAL = highFrequencyLagIntervalMs;

describe('DriftLag', () => {
    let mockReport : Mock;
    let currentTime : number;
    let driver : LagMonitorTestDriver<DriftLag>;

    beforeEach(() => {
        vi.useFakeTimers();
        currentTime = 1000;
        mockReport = vi.fn();
        driver = new LagMonitorTestDriver<DriftLag>(
            () => currentTime,
            (time) => currentTime = time,
            INTERVAL,
            mockReport
        );
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it.each([
        {expectedElapsed : driftStepMs, iterations : 1},
        {expectedElapsed : driftStepMs * 2, iterations : 2},
        {expectedElapsed : driftStepMs * 5, iterations : 5},
    ])('completes $iterations drift iterations for $expectedElapsed ms interval', ({expectedElapsed, iterations} : {expectedElapsed: number, iterations: number}) => {
        const testDriver = new LagMonitorTestDriver<DriftLag>(
            () => currentTime,
            (time) => currentTime = time,
            expectedElapsed,
            mockReport
        );
        testDriver.createMonitor(DriftLag);
        currentTime += expectedElapsed;

        for(let i = 0; i < iterations; i++) {
            vi.advanceTimersByTime(driftStepMs);
        }

        expect(mockReport).toHaveBeenCalledTimes(1);
    });

    it('rounds intervals down to nearest driftStepMs multiple', () => {
        const testCases = [
            {requested : 103, rounded : 100, iterations : 20} , // 103ms => 100ms ( 20 x 5ms )
            {requested : 107, rounded : 105, iterations : 21} , // 107ms => 105ms ( 21 x 5ms )
            {requested : 12, rounded : 10, iterations : 2} , // 12ms => 10ms ( 2 x 5ms )

        ];

        testCases.forEach(({requested, rounded, iterations}) => {
            vi.clearAllTimers();
            currentTime = 1000;
            const testDriver = new LagMonitorTestDriver<DriftLag>(
                () => currentTime,
                (time) => currentTime = time,
                requested,
                mockReport
            );
            testDriver.createMonitor(DriftLag);
            currentTime += rounded;

            for(let i = 0; i < iterations; i++) {
                vi.advanceTimersByTime(driftStepMs);
            }

            expect(mockReport).toHaveBeenCalledTimes(1);
            mockReport.mockClear();
        });
    });

    it('continuously reports lag measurements over multiple drift cycles', () => {
        driver.createMonitor(DriftLag);
        driver.tickSequence([3, -2]);
        driver.expectReportedLags([3, -2]);
    });

    it('calculates lag correctly across multiple measurements', () => {
        const driftLag = driver.createMonitor(DriftLag);

        const measurements = [
            { time : 1110,  expectedLag : 10 }, // 110 ms elapsed, 10ms lag
            { time : 1205, expectedLag : -5 }, // 95ms elapsed, 5ms ahead
        ];

        measurements.forEach(({time, expectedLag}) => {
            currentTime = time;
            expect(driftLag.measure()).toBe(expectedLag)
        });
    });

    it('logs errors and continues monitoring when report throws', () => {
        const error1 = new Error('First error');
        const error2 = new Error('Second error');

        mockReport
            .mockImplementationOnce(() => { throw error1; })
            .mockImplementationOnce(() => { throw error2; });

        driver.createMonitor(DriftLag);

        driver.tick(0); // First call throws error1
        expect(driver.mockLogger.log).toHaveBeenCalledWith(
            'error',
            'Error measuring/reporting lag.',
            expect.objectContaining({ error : error1, type : 'LagMonitor', subtype : 'DriftLag' }),
        );

        driver.tick(0); // Second call throws error2
        expect(driver.mockLogger.log).toHaveBeenCalledWith(
            'error',
            'Error measuring/reporting lag.',
            expect.objectContaining({ error : error2, type : 'LagMonitor', subtype : 'DriftLag' }),
        );

        driver.tick(0);
        expect(mockReport).toHaveBeenLastCalledWith(0);
        expect(mockReport).toHaveBeenCalledTimes(3);
    });

    it('uses consistent setTimeout intervals regardless of lag', () => {
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
        driver.createMonitor(DriftLag);
        driver.tickSequence([5, -5]);
        setTimeoutSpy.mock.calls.forEach(([_callback, interval]) => {
            expect(interval).toBe(driftStepMs);
        })
    });


});
