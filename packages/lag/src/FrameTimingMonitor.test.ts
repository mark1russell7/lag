import { vi, expect } from "vitest";
import { FrameTimingMonitor, type FrameMeasurement } from "./FrameTimingMonitor.js";

describe("FrameTimingMonitor", () => {
    function createDriver() {
        let currentTime = 0;
        const clock = { now : () => currentTime };
        const reports : FrameMeasurement[] = [];
        const logger = { log : vi.fn() };

        let pendingCallback : ((time : number) => void) | undefined;
        const rAFSpy = vi.fn((cb : (time : number) => void) => {
            pendingCallback = cb;
            return 1;
        });
        const cancelSpy = vi.fn();

        const monitor = new FrameTimingMonitor(
            (m) => reports.push(m),
            logger,
            rAFSpy,
            cancelSpy,
            clock,
            60, // 60fps target
        );

        const fireFrameAt = (time : number) : void => {
            currentTime = time;
            pendingCallback?.(time);
        };

        return { monitor, reports, rAFSpy, cancelSpy, fireFrameAt, logger };
    }

    it("schedules an animation frame on construction", () => {
        const { rAFSpy } = createDriver();
        expect(rAFSpy).toHaveBeenCalled();
    });

    it("does not report on the first frame (no previous baseline)", () => {
        const { reports, fireFrameAt } = createDriver();

        fireFrameAt(100);
        expect(reports).toHaveLength(0);
    });

    it("reports frame delta after the second frame", () => {
        const { reports, fireFrameAt } = createDriver();

        fireFrameAt(100);
        fireFrameAt(116.67); // ~16.67ms later = 60fps

        expect(reports).toHaveLength(1);
        expect(reports[0]!.frameDeltaMs).toBeCloseTo(16.67, 1);
        expect(reports[0]!.fps).toBeCloseTo(60, 0);
        expect(reports[0]!.isDropped).toBe(false);
    });

    it("flags dropped frames when delta > 2x target", () => {
        const { reports, fireFrameAt } = createDriver();

        fireFrameAt(0);
        fireFrameAt(50); // 50ms gap = ~3 frames at 60fps

        expect(reports[0]!.isDropped).toBe(true);
    });

    it("tracks dropped frame rate", () => {
        const { monitor, fireFrameAt } = createDriver();

        fireFrameAt(0);
        fireFrameAt(16.67);  // good
        fireFrameAt(33.34);  // good
        fireFrameAt(100);    // dropped (66ms gap)
        fireFrameAt(116.67); // good

        // 1 dropped out of 4 reported frames
        expect(monitor.getDroppedFrameRate()).toBeCloseTo(0.25);
    });

    it("resets counters", () => {
        const { monitor, fireFrameAt } = createDriver();

        fireFrameAt(0);
        fireFrameAt(100); // dropped
        expect(monitor.getDroppedFrameRate()).toBe(1);

        monitor.resetCounters();
        expect(monitor.getDroppedFrameRate()).toBe(0);
    });

    it("cancels pending frame on stop", () => {
        const { monitor, cancelSpy } = createDriver();
        monitor.stop();
        expect(cancelSpy).toHaveBeenCalled();
    });

    it("respects custom target FPS", () => {
        const reports : FrameMeasurement[] = [];
        const rAFSpy = vi.fn();
        let currentTime = 0;

        new FrameTimingMonitor(
            (m) => reports.push(m),
            { log : vi.fn() },
            rAFSpy as never,
            vi.fn(),
            { now : () => currentTime },
            30, // 30fps = 33.33ms target
        );

        const cb = rAFSpy.mock.calls[0]![0] as (t : number) => void;
        currentTime = 0;
        cb(0);

        // Capture next callback
        currentTime = 33.33;
        const cb2 = rAFSpy.mock.calls[1]![0] as (t : number) => void;
        cb2(33.33);

        expect(reports[0]!.targetFrameTimeMs).toBeCloseTo(33.33, 1);
        expect(reports[0]!.isDropped).toBe(false); // 33.33ms is exactly target, not 2x
    });
});
