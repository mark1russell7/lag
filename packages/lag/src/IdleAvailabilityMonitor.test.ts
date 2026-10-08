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
        const requestIdleSpy = vi.fn((cb : (d : IdleDeadline) => void, _options? : { timeout? : number }) => {
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

    describe("rules of the gaps and of the callback chain", () => {
        /** A monitor whose idle callbacks the test starts. Each request gets a new handle. */
        function createChain() {
            let currentTime = 0;
            const pending = new Map<number, (deadline : IdleDeadline) => void>();
            let nextHandle = 1;
            const reports : IdleMeasurement[] = [];
            const logger = { log : vi.fn() };
            const report = vi.fn((m : IdleMeasurement) => { reports.push(m); });
            const monitor = new IdleAvailabilityMonitor(
                report,
                logger,
                (cb) => {
                    const handle = nextHandle++;
                    pending.set(handle, cb);
                    return handle;
                },
                (handle) => { pending.delete(handle); },
                { now : () => currentTime },
            );
            const idle = (time : number) => {
                currentTime = time;
                const callbacks = [...pending.values()];
                pending.clear();
                for (const callback of callbacks) callback({ didTimeout : false, timeRemaining : () => 10 });
            };
            return { monitor, reports, report, logger, idle, pendingCount : () => pending.size };
        }

        it("gives a gap of 0 for the first callback after a restart", () => {
            const d = createChain();
            d.idle(100);
            d.monitor.stop();
            d.monitor.start();
            d.idle(5_000);

            expect(d.reports.map(r => r.timeSinceLastIdleMs)).toEqual([0, 0]);
        });

        it("measures the gap from a callback at the time 0", () => {
            const d = createChain();
            d.idle(0);
            d.idle(50);

            expect(d.reports.map(r => r.timeSinceLastIdleMs)).toEqual([0, 50]);
        });

        it("logs an error from the report function and continues with the next callback", () => {
            const d = createChain();
            d.report.mockImplementationOnce(() => { throw new Error("export failed"); });
            d.idle(100);
            d.idle(150);

            expect(d.logger.log).toHaveBeenCalledWith("error", "Error in idle measurement.", { error : expect.any(Error), type : "IdleAvailabilityMonitor" });
            expect(d.report).toHaveBeenCalledTimes(2);
        });

        it("leaves one waiting callback when report() stops and starts the monitor", () => {
            const d = createChain();
            d.report.mockImplementationOnce(() => {
                d.monitor.stop();
                d.monitor.start();
            });
            d.idle(100);

            expect(d.pendingCount()).toBe(1);
        });
    });
});
