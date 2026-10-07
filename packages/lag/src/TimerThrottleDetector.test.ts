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
});
