import { vi, expect } from "vitest";
import {
    IdleAvailabilityMonitor,
    type IdleDeadline,
    type IdleMeasurement,
} from "./IdleAvailabilityMonitor.js";

describe("IdleAvailabilityMonitor", () => {
    function createDriver() {
        let currentTime = 0;
        const clock = { now : () => currentTime };
        const reports : IdleMeasurement[] = [];

        let pendingCallback : ((d : IdleDeadline) => void) | undefined;
        const requestIdleSpy = vi.fn((cb : (d : IdleDeadline) => void) => {
            pendingCallback = cb;
            return 1;
        });
        const cancelIdleSpy = vi.fn();

        const monitor = new IdleAvailabilityMonitor(
            (m) => reports.push(m),
            { log : vi.fn() },
            requestIdleSpy,
            cancelIdleSpy,
            clock,
            1000,
        );

        const fireIdle = (
            time : number,
            timeRemaining : number,
            didTimeout = false,
        ) : void => {
            currentTime = time;
            pendingCallback?.({
                didTimeout,
                timeRemaining : () => timeRemaining,
            });
        };

        return { monitor, reports, requestIdleSpy, cancelIdleSpy, fireIdle };
    }

    it("schedules an idle callback on construction", () => {
        const { requestIdleSpy } = createDriver();
        expect(requestIdleSpy).toHaveBeenCalled();
        expect(requestIdleSpy.mock.calls[0]![1]).toEqual({ timeout : 1000 });
    });

    it("reports timeRemaining and didTimeout", () => {
        const { reports, fireIdle } = createDriver();

        fireIdle(100, 25, false);

        expect(reports).toHaveLength(1);
        expect(reports[0]!.timeRemainingMs).toBe(25);
        expect(reports[0]!.didTimeout).toBe(false);
    });

    it("reports timeSinceLastIdleMs as 0 on first fire", () => {
        const { reports, fireIdle } = createDriver();

        fireIdle(100, 30);
        expect(reports[0]!.timeSinceLastIdleMs).toBe(0);
    });

    it("reports time gap between idle fires", () => {
        const { reports, fireIdle } = createDriver();

        fireIdle(100, 30);
        fireIdle(150, 25);

        expect(reports[1]!.timeSinceLastIdleMs).toBe(50);
    });

    it("tracks timeout rate", () => {
        const { monitor, fireIdle } = createDriver();

        fireIdle(100, 25, false);
        fireIdle(200, 0,  true);  // forced via timeout
        fireIdle(300, 25, false);
        fireIdle(400, 0,  true);

        expect(monitor.getTimeoutRate()).toBe(0.5);
    });

    it("returns zero timeout rate before any fires", () => {
        const { monitor } = createDriver();
        expect(monitor.getTimeoutRate()).toBe(0);
    });

    it("resets counters", () => {
        const { monitor, fireIdle } = createDriver();

        fireIdle(100, 0, true);
        expect(monitor.getTimeoutRate()).toBe(1);

        monitor.resetCounters();
        expect(monitor.getTimeoutRate()).toBe(0);
    });

    it("cancels pending idle callback on stop", () => {
        const { monitor, cancelIdleSpy } = createDriver();
        monitor.stop();
        expect(cancelIdleSpy).toHaveBeenCalled();
    });
});
