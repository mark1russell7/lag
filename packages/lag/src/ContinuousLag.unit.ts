import { highFrequencyLagIntervalMs } from "./constants.js";
import { ContinuousLag } from "./ContinuousLag.js";
import { LagMonitorTestDriver } from "./test-utils.js";

jest.mock('imports/logger');

const INTERVAL = highFrequencyLagIntervalMs;

describe('ContinuousLag', () => {
    let mockReport : jest.Mock;
    let currentTime : number;
    let driver : LagMonitorTestDriver<ContinuousLag>;

    beforeEach(() => {
        jest.useFakeTimers();
        currentTime = 1000;
        jest.spyOn(performance, 'now').mockImplementation(() => currentTime);
        mockReport = jest.fn();
        driver = new LagMonitorTestDriver<ContinuousLag>(
            () => currentTime,
            (time) => currentTime = time,
            INTERVAL,
            mockReport
        ); 

    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it('starts the measurement loop immediately upon construction', () => {
        const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
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

    it('logs errors and continues monitoring when repor throws', () => {
        const error1 = new Error('First error');
        const error2 = new Error('Second error');

        mockReport
            .mockImplementationOnce(() => { throw error1; })
            .mockImplementationOnce(() => { throw error2; });
        driver.createMonitor(ContinuousLag);
        // First two calls throw errors
        driver.tick(0);
        expect(Logger.log).toHaveBeenCalledWith(
            'error',
            expect.objectContaining({error : error1}),
            expect.any(String)
        );
        driver.tick(0);
        expect(Logger.log).toHaveBeenCalledWith(
            'error',
            expect.objectContaining({error : error2}),
            expect.any(String)
        );

        // Third call succeeds 
        driver.tick(5);
        expect(mockReport).toHaveBeenLastCalledWith(5);
        expect(mockReport).toHaveBeenCalledTimes(3);

    })
})