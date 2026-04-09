import { vi, expect } from "vitest";
import {
    ComputePressureMonitor,
    type PressureMeasurement,
    type PressureObserverInit,
    type PressureRecord,
    type PressureObserverInstance,
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
});
