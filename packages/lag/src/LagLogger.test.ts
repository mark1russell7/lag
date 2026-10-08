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

    /** This method adds `count` measurements. The lag of each one is `utilizationPercent` of its interval. */
    add(utilizationPercent : number, count : number, attributes? : EventLoopLagAttributes) : void {
        const value = (utilizationPercent / 100) * MEASUREMENT_INTERVAL;
        for(let i = 0; i < count; i++) {
            this.monitor.addMeasurement({
                value,
                attributes : attributes ?? this.visibileAttributes
            })
        }
    }

    /** This method fills the rest of a report period with measurements of 0 ms lag. */
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

    it('uses the interval of each measurement, for example windows of 93 ms', () => {
        // Firefox and WebKit on Windows: 6 steps of 15.6 ms
        const add = (utilizationPercent : number, count : number) => {
            for (let i = 0; i < count; i++) {
                driver.monitor.addMeasurement({ value : (utilizationPercent / 100) * 93, attributes : driver.visibileAttributes, intervalMs : 93 });
            }
        };
        // 2 s are 22 windows of 93 ms
        add(120, 22);
        // 30 s are 323 windows of 93 ms: 322 windows give no report
        add(0, 300);
        expect(mockLogger.log).not.toHaveBeenCalled();
        add(0, 1);
        expect(mockLogger.log).toHaveBeenCalledTimes(1);
        expect(mockLogger.log).toHaveBeenCalledWith('warn', 'Average event loop lag exceeded threshold', expect.objectContaining({
            lag : '120.0',
            duration : shortLagDuration,
        }));
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

    describe('rules of the periods', () => {
        it('warns for a 2 s period of high lag that comes after 10 s of low lag', () => {
            driver.add(0, 100);
            driver.add(150, 20);
            driver.fillToReport(120);

            expect(mockLogger.log).toHaveBeenCalledWith('warn', 'Average event loop lag exceeded threshold', expect.objectContaining({ duration : shortLagDuration }));
        });

        it('averages the lag of the most recent samples that cover the period, and no older sample', () => {
            // The last 20 samples (2 s) average 104 %. With one more sample of 0 %, the average is less than 100 %.
            driver.add(0, 30);
            driver.add(104, 20);
            driver.fillToReport(50);

            expect(mockLogger.log).toHaveBeenCalledWith('warn', 'Average event loop lag exceeded threshold', expect.objectContaining({ duration : shortLagDuration, lag : '104.0' }));
        });

        it('does not warn for an average of exactly the threshold', () => {
            driver.add(100, 20);
            driver.fillToReport(20);

            expect(mockLogger.log).not.toHaveBeenCalled();
        });

        it('does not warn for one long sample that the 2 s period averages below 100 %', () => {
            driver.add(0, 50);
            driver.add(300, 1);
            driver.fillToReport(51);

            expect(mockLogger.log).not.toHaveBeenCalled();
        });

        it('warns for a 5 s period at the start of each report period', () => {
            // The first 5 s (50 samples) of each period have a lag of 51 %
            driver.add(51, 50);
            driver.fillToReport(50);
            driver.add(51, 50);
            driver.fillToReport(50);

            const longWarnings = mockLogger.log.mock.calls.filter(([, , attributes]) => (attributes as { duration : number }).duration === longLagDuration);
            expect(longWarnings).toHaveLength(2);
        });

        it('uses the measurement interval when a measurement gives an interval of 0', () => {
            const monitor = new LagLogger(MEASUREMENT_INTERVAL, mockLogger);
            for (let i = 0; i < driver.reportSamples; i++) {
                monitor.addMeasurement({ value : i < 20 ? 150 : 0, attributes : { wasHidden : false }, intervalMs : 0 });
            }

            expect(mockLogger.log).toHaveBeenCalledWith('warn', 'Average event loop lag exceeded threshold', expect.objectContaining({ duration : shortLagDuration }));
        });
    });
});
