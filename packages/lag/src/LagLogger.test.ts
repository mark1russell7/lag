import type { Mock } from 'vitest';
import { highFrequencyLagIntervalMs, lagLoggingIntervalMs, longLagDuration, longLagThreshold, shortLagDuration, shortLagThreshold } from "./constants.js";
import { LagLogger } from "./LagLogger.js";
import type { EventLoopLagAttributes } from "./types.js";

const MEASUREMENT_INTERVAL = highFrequencyLagIntervalMs;

class TestDriver {
    public reportSamples = lagLoggingIntervalMs / MEASUREMENT_INTERVAL;
    public shortSamples = shortLagDuration / MEASUREMENT_INTERVAL;
    public longSamples = longLagDuration / MEASUREMENT_INTERVAL;

    constructor(public monitor : LagLogger) {}

    /** Adds a specified number of measurements with a given utilization percentage. */
    add(utilizationPercent : number, count : number, attributes? : EventLoopLagAttributes) : void {
        const value = (utilizationPercent / 100) * MEASUREMENT_INTERVAL;
        for(let i = 0; i < count; i++) {
            this.monitor.addMeasurement({
                value,
                attributes : attributes ?? this.visibileAttributes
            })
        }
    }

    /** Fills the remaining time in a reporting window with zero-lag measurements  */
    fillToReport(currentSampleCount : number) : void {
        const remaining = this.reportSamples - currentSampleCount;
        if(remaining > 0) {
            this.add(0, remaining);
        }
    }

    public visibileAttributes : EventLoopLagAttributes = {
        wasHidden : false,
    };

    public hiddenAttributes : EventLoopLagAttributes = {
        wasHidden : true,
    };
}

describe('LagLogger', () => {

    let driver: TestDriver;
    let mockLogger : { log : Mock };

    beforeEach(() => {
        mockLogger = { log : vi.fn() };
        const monitor = new LagLogger(MEASUREMENT_INTERVAL, mockLogger)
        driver = new TestDriver(monitor);
        vi.clearAllMocks();
    });

    it('should not log anything if utilization remains low', () => {
        driver.add(10, driver.reportSamples); // 10% utilization for an entire reporting window
        expect(mockLogger.log).not.toHaveBeenCalled();
    });

    it('should ignore all measurements if the tab was hidden', () => {
        driver.add(200 , driver.reportSamples, driver.hiddenAttributes); // 200% utilization but tab is hidden
        expect(mockLogger.log).not.toHaveBeenCalled();
    });

    it('should log warnings for both short and long-term violations if utilization is high enough', () => {
        // Add a burst of 150% utilization long enough to violate both thresholds
        driver.add(150, driver.longSamples);
        driver.fillToReport(driver.longSamples);

        expect(mockLogger.log).toHaveBeenCalledTimes(2);
        expect(mockLogger.log).toHaveBeenNthCalledWith(
            1,
            'warn',
            'Average event loop lag exceeded threshold',
            expect.objectContaining({
                lag : '150.0',
                threshold : shortLagThreshold,
                duration : shortLagDuration,
                wasHidden : false,
            }),
        );

        expect(mockLogger.log).toHaveBeenNthCalledWith(
            2,
            'warn',
            'Average event loop lag exceeded threshold',
            expect.objectContaining({
                lag : '150.0',
                threshold : longLagThreshold,
                duration : longLagDuration,
                wasHidden : false,
            }),
        );
    });
    it('should reset its internal state after reporting', () => {
        //First period: High utilization triggers logs
        driver.add(200, driver.reportSamples);
        expect(mockLogger.log).toHaveBeenCalled();

        vi.clearAllMocks();

        // Second period: Low utilization should not trigger logs if state was reset
        driver.add(10, driver.reportSamples);
        expect(mockLogger.log).not.toHaveBeenCalled();
    });

    it('should handle buffer size correctly without unbounded growth', () => {
        const excessiveMeasurements = driver.reportSamples  * 3;
        driver.add(150, excessiveMeasurements); // Add enough measurements to exceed buffer size multiple times

        expect(mockLogger.log).toHaveBeenCalled();
    });

    describe.each([
        {
            name: 'short-term',
            threshold : shortLagThreshold,
            duration : shortLagDuration,
            samples : shortLagDuration / MEASUREMENT_INTERVAL,
        },
        {
            name: 'long-term',
            threshold : longLagThreshold,
            duration : longLagDuration,
            samples : longLagDuration / MEASUREMENT_INTERVAL,
        }
    ])('$name lag detection', ({threshold, duration, samples}) => {
        it(`should log a warning when average lag exceeds ${threshold}% over ${duration}ms`, () => {
            const utilization = threshold + 10;
            driver.add(utilization, samples);
            driver.fillToReport(samples);

            expect(mockLogger.log).toHaveBeenCalledTimes(1);
            expect(mockLogger.log).toHaveBeenCalledWith(
                'warn',
                'Average event loop lag exceeded threshold',
                expect.objectContaining({
                    threshold,
                    duration,
                    type : 'LagMonitor',
                    subtype : 'LagLogger'
                })
            )
        });

        it('should not log if utilization is below $threshold %', () => {
            const utilization = threshold - 10;
            driver.add(utilization, samples);
            driver.fillToReport(samples);
            expect(mockLogger.log).not.toHaveBeenCalled();
        });
    })
});
