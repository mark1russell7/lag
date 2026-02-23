import type { Mock } from 'vitest';
import { highFrequencyLagIntervalMs } from "./constants.js";
import { ContinuousLag } from "./ContinuousLag.js";
import { LagMonitorTestDriver } from "./test-utils.js";

const INTERVAL = highFrequencyLagIntervalMs;

describe('ContinuousLag', () => {
    let mockReport : Mock;
    let currentTime : number;
    let driver : LagMonitorTestDriver<ContinuousLag>;

    beforeEach(() => {
        vi.useFakeTimers();
        currentTime = 1000;
        mockReport = vi.fn();
        driver = new LagMonitorTestDriver<ContinuousLag>(
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

    it('starts the measurement loop immediately upon construction', () => {
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
        driver.createMonitor(ContinuousLag);
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), INTERVAL);
        expect(setTimeoutSpy).toHaveBeenCalledTimes(1);
    });
    it.each([
        {lagMs : 15, description: 'positive lag'},
        {lagMs : -10, description: 'negative lag (ahead of schedule)'},
    ])('calculates $description correctly', ({lagMs}) => {
        const monitor = driver.createMonitor(ContinuousLag);
        // Simulate time passing: action time = interval + lag
        const expectedTime = currentTime + INTERVAL + lagMs;
        currentTime = expectedTime;
        const lag = monitor.measure();
        expect(lag).toBeCloseTo(lagMs);
    });

    it('continuously reports lag measurements over multiple intervals', () => {
        driver.createMonitor(ContinuousLag);
        driver.tickSequence([5, -2, 10]);
        driver.expectReportedLags([5, -2, 10]);
    });

    it('logs errors and continues monitoring when report throws', () => {
        const error1 = new Error('First error');
        const error2 = new Error('Second error');

        mockReport
            .mockImplementationOnce(() => { throw error1; })
            .mockImplementationOnce(() => { throw error2; });
        driver.createMonitor(ContinuousLag);
        // First two calls throw errors
        driver.tick(0);
        expect(driver.mockLogger.log).toHaveBeenCalledWith(
            'error',
            'Error measuring/reporting lag.',
            expect.objectContaining({ error : error1, type : 'LagMonitor', subtype : 'ContinuousLag' }),
        );
        driver.tick(0);
        expect(driver.mockLogger.log).toHaveBeenCalledWith(
            'error',
            'Error measuring/reporting lag.',
            expect.objectContaining({ error : error2, type : 'LagMonitor', subtype : 'ContinuousLag' }),
        );

        // Third call succeeds
        driver.tick(5);
        expect(mockReport).toHaveBeenLastCalledWith(5);
        expect(mockReport).toHaveBeenCalledTimes(3);

    })
})
