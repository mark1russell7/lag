import { vi, expect } from "vitest";
import { TimerThrottleDetector } from "./TimerThrottleDetector.js";

describe("TimerThrottleDetector", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("reports not throttled when timers fire on time", () => {
        let currentTime = 0;
        const clock = { now : () => currentTime };
        const logger = { log : vi.fn() };

        const detector = new TimerThrottleDetector(
            vi.fn(),
            setTimeout,
            clearTimeout,
            clock,
            logger,
        );

        detector.start();

        // Run 5 calibration samples, each advancing 5ms (the target)
        for (let i = 0; i < 5; i++) {
            currentTime += 5;
            vi.advanceTimersByTime(5);
        }

        expect(detector.isThrottled()).toBe(false);
    });

    it("reports throttled when timers are delayed", () => {
        let currentTime = 0;
        const clock = { now : () => currentTime };
        const logger = { log : vi.fn() };

        const detector = new TimerThrottleDetector(
            vi.fn(),
            setTimeout,
            clearTimeout,
            clock,
            logger,
        );

        detector.start();

        // Run 5 calibration samples, each delayed by 200ms (way over 100ms threshold)
        for (let i = 0; i < 5; i++) {
            currentTime += 200;
            vi.advanceTimersByTime(5);
        }

        expect(detector.isThrottled()).toBe(true);
        expect(logger.log).toHaveBeenCalledWith(
            "warn",
            "Timer throttling detected.",
            expect.objectContaining({ throttledSamples : 5 }),
        );
    });

    it("transitions from throttled to not throttled", () => {
        let currentTime = 0;
        const clock = { now : () => currentTime };
        const logger = { log : vi.fn() };

        const detector = new TimerThrottleDetector(
            vi.fn(),
            setTimeout,
            clearTimeout,
            clock,
            logger,
            { calibrationIntervalMs : 100 },
        );

        detector.start();

        // First calibration: throttled
        for (let i = 0; i < 5; i++) {
            currentTime += 200;
            vi.advanceTimersByTime(5);
        }
        expect(detector.isThrottled()).toBe(true);

        // Advance past calibration interval
        currentTime += 100;
        vi.advanceTimersByTime(100);

        // Second calibration: not throttled
        for (let i = 0; i < 5; i++) {
            currentTime += 5;
            vi.advanceTimersByTime(5);
        }
        expect(detector.isThrottled()).toBe(false);
        expect(logger.log).toHaveBeenCalledWith(
            "info",
            "Timer throttling ended.",
            expect.any(Object),
        );
    });

    it("stops calibration when stop() is called", () => {
        let currentTime = 0;
        const clock = { now : () => currentTime };
        const logger = { log : vi.fn() };

        const detector = new TimerThrottleDetector(
            vi.fn(),
            setTimeout,
            clearTimeout,
            clock,
            logger,
        );

        detector.start();
        detector.stop();

        // Advancing timers should not cause any calibration
        currentTime += 200;
        vi.advanceTimersByTime(5);

        expect(detector.isThrottled()).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("prevents double-start", () => {
        const mockSetTimeout = vi.fn(setTimeout);
        const clock = { now : () => 0 };
        const logger = { log : vi.fn() };

        const detector = new TimerThrottleDetector(
            vi.fn(),
            mockSetTimeout,
            clearTimeout,
            clock,
            logger,
        );

        detector.start();
        const callCount = mockSetTimeout.mock.calls.length;

        detector.start(); // should be no-op
        expect(mockSetTimeout.mock.calls.length).toBe(callCount);
    });

    it("restarting does not leave a second calibration chain running", () => {
        let currentTime = 0;
        const mockSetTimeout = vi.fn(setTimeout);
        const detector = new TimerThrottleDetector(
            vi.fn(),
            mockSetTimeout,
            clearTimeout,
            { now : () => currentTime },
            { log : vi.fn() },
            { calibrationIntervalMs : 100 },
        );

        detector.start();
        detector.stop();
        detector.start();

        // Run several full calibration rounds
        for (let i = 0; i < 50; i++) {
            currentTime += 5;
            vi.advanceTimersByTime(5);
        }

        // A single chain only ever has one timer pending
        expect(vi.getTimerCount()).toBe(1);
    });

    it("stop() from inside the logger (on a throttle change) sticks", () => {
        let currentTime = 0;
        const logger = { log : vi.fn() };
        const detector = new TimerThrottleDetector(
            vi.fn(),
            setTimeout,
            clearTimeout,
            { now : () => currentTime },
            logger,
        );
        logger.log.mockImplementation(() => detector.stop());

        detector.start();
        for (let i = 0; i < 5; i++) {
            currentTime += 200;
            vi.advanceTimersByTime(5);
        }

        expect(logger.log).toHaveBeenCalledWith("warn", "Timer throttling detected.", expect.anything());
        expect(vi.getTimerCount()).toBe(0);
    });

    it("reports every calibration round", () => {
        let currentTime = 0;
        const report = vi.fn();
        const detector = new TimerThrottleDetector(
            report,
            setTimeout,
            clearTimeout,
            { now : () => currentTime },
            { log : vi.fn() },
            { calibrationIntervalMs : 100 },
        );

        detector.start();
        for (let i = 0; i < 5; i++) {
            currentTime += 200;
            vi.advanceTimersByTime(5);
        }
        currentTime += 100;
        vi.advanceTimersByTime(100);
        for (let i = 0; i < 5; i++) {
            currentTime += 5;
            vi.advanceTimersByTime(5);
        }

        expect(report.mock.calls.map(c => c[0])).toEqual([
            { throttled : true, throttledSamples : 5, totalSamples : 5 },
            { throttled : false, throttledSamples : 0, totalSamples : 5 },
        ]);
    });

    describe("rules of a calibration round", () => {
        /** A detector on fake timers. Each calibration sample takes the next delay of `sampleDelays` (5 ms after they end). */
        function createDetector(sampleDelays : number[], calibrationSamples : number, report = vi.fn()) {
            const logger = { log : vi.fn() };
            const detector = new TimerThrottleDetector(
                report,
                (fn, ms) => setTimeout(fn, ms === 5 ? sampleDelays.shift() ?? 5 : ms) as unknown as number,
                (id) => clearTimeout(id),
                { now : () => Date.now() },
                logger,
                { calibrationTargetMs : 5, throttleThresholdMs : 100, calibrationSamples, calibrationIntervalMs : 1_000 },
            );
            detector.start();
            return { detector, logger, report };
        }

        it("does not count a sample of exactly the threshold as throttled", () => {
            const d = createDetector([100], 1);
            vi.advanceTimersByTime(100);

            expect(d.report).toHaveBeenCalledWith({ throttled : false, throttledSamples : 0, totalSamples : 1 });
            d.detector.stop();
        });

        it("is not throttled when exactly half of the samples are throttled", () => {
            const d = createDetector([200, 5], 2);
            vi.advanceTimersByTime(205);

            expect(d.report).toHaveBeenCalledWith({ throttled : false, throttledSamples : 1, totalSamples : 2 });
            d.detector.stop();
        });

        it("logs an error from the report function and starts the next round", () => {
            const report = vi.fn();
            report.mockImplementationOnce(() => { throw new Error("export failed"); });
            const d = createDetector([], 1, report);
            vi.advanceTimersByTime(5 + 1_000 + 5);

            expect(d.logger.log).toHaveBeenCalledWith("error", "Error reporting timer calibration.", { error : expect.any(Error), type : "TimerThrottleDetector" });
            expect(report).toHaveBeenCalledTimes(2);
            d.detector.stop();
        });

        it("logs the start of the throttling and its end one time each", () => {
            // The rounds are normal, throttled, throttled, normal and normal
            const d = createDetector([5, 200, 200, 5, 5], 1);
            vi.advanceTimersByTime(5 + 1_000 + 200 + 1_000 + 200 + 1_000 + 5 + 1_000 + 5);
            d.detector.stop();

            expect(d.logger.log.mock.calls).toEqual([
                ["warn", "Timer throttling detected.", { type : "TimerThrottleDetector", throttledSamples : 1, totalSamples : 1 }],
                ["info", "Timer throttling ended.", { type : "TimerThrottleDetector" }],
            ]);
        });
    });
});
