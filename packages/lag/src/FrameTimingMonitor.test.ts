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

    it("reports zero dropped frames for an on-time frame", () => {
        const { reports, fireFrameAt } = createDriver();

        fireFrameAt(100);
        fireFrameAt(116.67); // ~16.67ms later = 60fps

        expect(reports).toHaveLength(1);
        expect(reports[0]!.frameDeltaMs).toBeCloseTo(16.67, 1);
        expect(reports[0]!.fps).toBeCloseTo(60, 0);
        expect(reports[0]!.droppedFrames).toBe(0);
        expect(reports[0]!.isDropped).toBe(false);
    });

    it("reports exact dropped frame count for a delayed frame", () => {
        const { reports, fireFrameAt } = createDriver();

        // 50ms gap at 60fps = ~3 frame slots → 2 dropped frames
        fireFrameAt(0);
        fireFrameAt(50);

        expect(reports[0]!.droppedFrames).toBe(2);
        expect(reports[0]!.isDropped).toBe(true);
    });

    it("counts a 100ms gap as 5 dropped frames at 60fps", () => {
        const { reports, fireFrameAt } = createDriver();

        // 100ms / 16.67 = 6 slots, 6 - 1 = 5 dropped
        fireFrameAt(0);
        fireFrameAt(100);

        expect(reports[0]!.droppedFrames).toBe(5);
    });

    it("tolerates slightly-late frames (16.67 → 17ms)", () => {
        const { reports, fireFrameAt } = createDriver();

        fireFrameAt(0);
        fireFrameAt(17); // very slightly late, still rounds to 1 slot
        expect(reports[0]!.droppedFrames).toBe(0);
    });

    it("tracks total dropped frames and dropped frame rate", () => {
        const { monitor, fireFrameAt } = createDriver();

        fireFrameAt(0);
        fireFrameAt(16.67);  // 0 dropped, 1 observed
        fireFrameAt(33.34);  // 0 dropped, 1 observed
        // 100 - 33.34 = 66.66ms gap. round(66.66 / 16.67) = 4 slots, -1 = 3 dropped
        fireFrameAt(100);
        fireFrameAt(116.67); // 0 dropped, 1 observed

        expect(monitor.getDroppedTotal()).toBe(3);
        expect(monitor.getObservedTotal()).toBe(4);
        // Rate = dropped / (observed + dropped) = 3 / 7
        expect(monitor.getDroppedFrameRate()).toBeCloseTo(3 / 7);
    });

    it("resets counters", () => {
        const { monitor, fireFrameAt } = createDriver();

        fireFrameAt(0);
        fireFrameAt(100);
        expect(monitor.getDroppedTotal()).toBe(5);

        monitor.resetCounters();
        expect(monitor.getDroppedTotal()).toBe(0);
        expect(monitor.getObservedTotal()).toBe(0);
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
        // 33.33ms / 33.33ms = 1 slot, 0 dropped
        expect(reports[0]!.droppedFrames).toBe(0);
    });
});
