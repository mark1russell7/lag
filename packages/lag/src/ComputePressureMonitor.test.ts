import { vi, expect } from "vitest";
import {
    ComputePressureMonitor,
    type PressureMeasurement,
    type PressureObserverInit,
    type PressureRecord,
} from "./ComputePressureMonitor.js";

function createMockPressureObserver() {
    let capturedCallback : ((records : PressureRecord[]) => void) | undefined;
    const observeSpy = vi.fn((_source : string) => Promise.resolve());
    const disconnectSpy = vi.fn();
    let constructCount = 0;

    class MockObserver {
        constructor(callback : (records : PressureRecord[]) => void) {
            capturedCallback = callback;
            constructCount++;
        }
        observe = observeSpy;
        disconnect = disconnectSpy;
        takeRecords = () => [] as PressureRecord[];
    }

    return {
        Ctor : MockObserver as unknown as PressureObserverInit,
        observeSpy,
        disconnectSpy,
        get constructCount() { return constructCount; },
        emit(records : PressureRecord[]) {
            capturedCallback?.(records);
        },
    };
}

describe("ComputePressureMonitor", () => {
    it("constructs a PressureObserver and observes the configured sources", () => {
        const mock = createMockPressureObserver();
        new ComputePressureMonitor(
            ["cpu"],
            vi.fn(),
            { log : vi.fn() },
            mock.Ctor,
        );

        expect(mock.constructCount).toBe(1);
        expect(mock.observeSpy).toHaveBeenCalledWith("cpu", expect.objectContaining({
            sampleInterval : 1000,
        }));
    });

    it("reports records with state ordinals", () => {
        const mock = createMockPressureObserver();
        const reports : PressureMeasurement[] = [];

        new ComputePressureMonitor(
            ["cpu"],
            (m) => reports.push(m),
            { log : vi.fn() },
            mock.Ctor,
        );

        mock.emit([
            { source : "cpu", state : "nominal",  time : 100 },
            { source : "cpu", state : "fair",     time : 200 },
            { source : "cpu", state : "serious",  time : 300 },
            { source : "cpu", state : "critical", time : 400 },
        ]);

        expect(reports).toHaveLength(4);
        expect(reports.map(r => r.stateOrdinal)).toEqual([0, 1, 2, 3]);
        expect(reports[0]!.source).toBe("cpu");
        expect(reports[0]!.timestamp).toBe(100);
    });

    it("tracks the latest state per source", () => {
        const mock = createMockPressureObserver();
        const monitor = new ComputePressureMonitor(
            ["cpu"],
            vi.fn(),
            { log : vi.fn() },
            mock.Ctor,
        );

        mock.emit([{ source : "cpu", state : "nominal", time : 0 }]);
        expect(monitor.getCurrentState("cpu")).toBe("nominal");

        mock.emit([{ source : "cpu", state : "serious", time : 100 }]);
        expect(monitor.getCurrentState("cpu")).toBe("serious");
    });

    it("getWorstStateOrdinal returns the max across sources", () => {
        const mock = createMockPressureObserver();
        const monitor = new ComputePressureMonitor(
            ["cpu", "thermals"],
            vi.fn(),
            { log : vi.fn() },
            mock.Ctor,
        );

        mock.emit([
            { source : "cpu",      state : "fair",     time : 0 },
            { source : "thermals", state : "critical", time : 0 },
        ]);

        expect(monitor.getWorstStateOrdinal()).toBe(3); // critical
    });

    it("returns -1 worst ordinal before any samples", () => {
        const mock = createMockPressureObserver();
        const monitor = new ComputePressureMonitor(
            ["cpu"], vi.fn(), { log : vi.fn() }, mock.Ctor,
        );
        expect(monitor.getWorstStateOrdinal()).toBe(-1);
    });

    it("logs a warning if observe() rejects (unsupported source)", async () => {
        const logger = { log : vi.fn() };
        let rejectFn : (error : Error) => void = () => {};
        const observePromise = new Promise<void>((_, reject) => { rejectFn = reject; });

        class MockObserver {
            constructor(_cb : never) {}
            observe = () => observePromise;
            disconnect = vi.fn();
            takeRecords = () => [];
        }

        new ComputePressureMonitor(
            ["thermals"],
            vi.fn(),
            logger,
            MockObserver as unknown as PressureObserverInit,
        );

        rejectFn(new Error("not supported"));
        await Promise.resolve();
        await Promise.resolve();

        expect(logger.log).toHaveBeenCalledWith(
            "warn",
            expect.stringContaining("not supported"),
            expect.any(Object),
        );
    });

    it("logs a warning if PressureObserver constructor throws", () => {
        const logger = { log : vi.fn() };
        const ThrowingCtor = (function () {
            throw new Error("PressureObserver undefined");
        }) as unknown as PressureObserverInit;

        new ComputePressureMonitor(
            ["cpu"], vi.fn(), logger, ThrowingCtor,
        );

        expect(logger.log).toHaveBeenCalledWith(
            "warn",
            "PressureObserver not available in this browser.",
            expect.any(Object),
        );
    });

    it("disconnects on stop and clears state", () => {
        const mock = createMockPressureObserver();
        const monitor = new ComputePressureMonitor(
            ["cpu"], vi.fn(), { log : vi.fn() }, mock.Ctor,
        );

        mock.emit([{ source : "cpu", state : "fair", time : 0 }]);
        expect(monitor.getCurrentState("cpu")).toBe("fair");

        monitor.stop();
        expect(mock.disconnectSpy).toHaveBeenCalled();
        expect(monitor.getCurrentState("cpu")).toBeUndefined();
    });

    it("prevents double-start", () => {
        const mock = createMockPressureObserver();
        const monitor = new ComputePressureMonitor(
            ["cpu"], vi.fn(), { log : vi.fn() }, mock.Ctor,
        );
        monitor.start();
        expect(mock.constructCount).toBe(1);
    });

    describe("rules of the observer", () => {
        it("observes again after stop() and start()", () => {
            const mock = createMockPressureObserver();
            const monitor = new ComputePressureMonitor(["cpu"], vi.fn(), { log : vi.fn() }, mock.Ctor);

            monitor.stop();
            monitor.start();

            expect(mock.constructCount).toBe(2);
            expect(mock.observeSpy).toHaveBeenCalledTimes(2);
        });

        it("stop() works, and the monitor logs the reason, when the browser has no PressureObserver", () => {
            const logger = { log : vi.fn() };
            const Missing = class { constructor() { throw new Error("not supported"); } } as unknown as PressureObserverInit;
            const monitor = new ComputePressureMonitor(["cpu"], vi.fn(), logger, Missing);

            expect(() => monitor.stop()).not.toThrow();
            expect(logger.log).toHaveBeenCalledWith("warn", "PressureObserver not available in this browser.", { error : expect.any(Error), type : "ComputePressureMonitor" });
        });

        it("logs the source that the browser does not support", async () => {
            const mock = createMockPressureObserver();
            mock.observeSpy.mockImplementationOnce(() => Promise.reject(new Error("unsupported")));
            const logger = { log : vi.fn() };
            new ComputePressureMonitor(["thermals"], vi.fn(), logger, mock.Ctor);
            await Promise.resolve();
            await Promise.resolve();

            expect(logger.log).toHaveBeenCalledWith("warn", 'PressureObserver source "thermals" not supported.', { error : expect.any(Error), type : "ComputePressureMonitor" });
        });

        it("gives the most severe state of all sources, also when a less severe record comes last", () => {
            const mock = createMockPressureObserver();
            const monitor = new ComputePressureMonitor(["cpu", "thermals"], vi.fn(), { log : vi.fn() }, mock.Ctor);

            mock.emit([{ source : "cpu", state : "serious", time : 0 }, { source : "thermals", state : "fair", time : 0 }]);

            expect(monitor.getWorstStateOrdinal()).toBe(2);
        });

        it("logs no warning when stop() rejects the pending observe() calls, also after a new start", async () => {
            // As the specification tells: disconnect() rejects each pending observe() with an AbortError
            const pending = new Set<(error : Error) => void>();
            class SpecObserver {
                constructor(_callback : never) {}
                observe() {
                    return new Promise<void>((_, reject) => { pending.add(reject); });
                }
                disconnect() {
                    for (const reject of pending) reject(new DOMException("The observer disconnected.", "AbortError"));
                    pending.clear();
                }
                takeRecords() { return []; }
            }
            const logger = { log : vi.fn() };
            const monitor = new ComputePressureMonitor(["cpu", "thermals"], vi.fn(), logger, SpecObserver as unknown as PressureObserverInit);

            monitor.stop();
            monitor.start();
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(logger.log).not.toHaveBeenCalled();

            // A rejection of the current observer still gives the warning
            for (const reject of pending) reject(new DOMException("No such source.", "NotSupportedError"));
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(logger.log.mock.calls.map(call => call[1])).toEqual([
                'PressureObserver source "cpu" not supported.',
                'PressureObserver source "thermals" not supported.',
            ]);
        });

        it("logs an error from the report function and continues with the next record", () => {
            const mock = createMockPressureObserver();
            const logger = { log : vi.fn() };
            const report = vi.fn<(m : PressureMeasurement) => void>();
            report.mockImplementationOnce(() => { throw new Error("export failed"); });
            new ComputePressureMonitor(["cpu"], report, logger, mock.Ctor);

            mock.emit([{ source : "cpu", state : "fair", time : 0 }, { source : "cpu", state : "critical", time : 1 }]);

            expect(logger.log).toHaveBeenCalledWith("error", "Error processing pressure record.", { error : expect.any(Error), type : "ComputePressureMonitor" });
            expect(report).toHaveBeenLastCalledWith(expect.objectContaining({ state : "critical", stateOrdinal : 3 }));
        });
    });
});
