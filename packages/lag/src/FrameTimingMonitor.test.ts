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

    it("stop() + start() inside report: one rAF chain, and no frame spanning the pause", () => {
        let now = 0;
        let nextId = 0;
        const pending = new Map<number, (time : number) => void>();
        const reports : FrameMeasurement[] = [];
        let restartOnReport = false;

        const monitor : FrameTimingMonitor = new FrameTimingMonitor(
            (m) => {
                reports.push(m);
                if (restartOnReport) {
                    restartOnReport = false;
                    monitor.stop();
                    monitor.start();
                }
            },
            { log : vi.fn() },
            (cb) => { const id = ++nextId; pending.set(id, cb); return id; },
            (id) => { pending.delete(id); },
            { now : () => now },
        );
        const fire = (time : number) => {
            now = time;
            const callbacks = [...pending.values()];
            pending.clear();
            for (const cb of callbacks) cb(time);
        };

        fire(0);
        fire(16);
        restartOnReport = true;
        fire(32);
        expect(pending.size).toBe(1);

        fire(10_000); // first frame after the restart only sets the baseline
        fire(10_016);
        expect(reports.map(r => r.frameDeltaMs)).toEqual([16, 16, 16]);
    });

    describe("automatic frame interval", () => {
        function createAutoDriver() {
            let currentTime = 0;
            const reports : FrameMeasurement[] = [];
            let pending : ((time : number) => void) | undefined;
            const monitor = new FrameTimingMonitor(
                (m) => reports.push(m),
                { log : vi.fn() },
                (cb) => { pending = cb; return 1; },
                vi.fn(),
                { now : () => currentTime },
            );
            const frames = (deltaMs : number, count : number) => {
                for (let i = 0; i < count; i++) {
                    currentTime += deltaMs;
                    pending?.(currentTime);
                }
            };
            return { monitor, reports, frames };
        }

        it("follows a 120 Hz display", () => {
            const d = createAutoDriver();
            d.frames(8.33, 50);
            d.frames(16.66, 1); // one frame missed at 120 Hz
            expect(d.monitor.getFrameIntervalMs()).toBeCloseTo(8.33);
            expect(d.reports.at(-1)!.droppedFrames).toBe(1);
        });

        it("does not count a 30 fps limit (power saving) as dropped frames", () => {
            const d = createAutoDriver();
            d.frames(33.33, 100);
            expect(d.reports.slice(5).every(r => r.droppedFrames === 0)).toBe(true);
            expect(d.monitor.getFrameIntervalMs()).toBeCloseTo(33.33);
        });

        it("keeps the estimate through a burst of jank", () => {
            const d = createAutoDriver();
            d.frames(16.67, 100);
            d.frames(50, 60);
            expect(d.monitor.getFrameIntervalMs()).toBeCloseTo(16.67);
            expect(d.reports.at(-1)!.droppedFrames).toBe(2);
        });

        it("ignores deltas too short to be a refresh interval", () => {
            const d = createAutoDriver();
            d.frames(16.67, 10);
            d.frames(1, 1);
            expect(d.monitor.getFrameIntervalMs()).toBeCloseTo(16.67);
        });
    });

    describe("rules of the frame interval", () => {
        function createAutoMonitor(targetFps? : "auto") {
            let currentTime = 0;
            let pending : ((time : number) => void) | undefined;
            const reports : FrameMeasurement[] = [];
            const logger = { log : vi.fn() };
            const report = vi.fn((m : FrameMeasurement) => { reports.push(m); });
            const monitor = new FrameTimingMonitor(report, logger, (cb) => { pending = cb; return 1; }, vi.fn(), { now : () => currentTime }, targetFps);
            const frames = (deltaMs : number, count : number) => {
                for (let i = 0; i < count; i++) {
                    currentTime += deltaMs;
                    pending?.(currentTime);
                }
            };
            return { monitor, reports, report, logger, frames };
        }

        it("uses 60 Hz before the first frames", () => {
            expect(createAutoMonitor().monitor.getFrameIntervalMs()).toBeCloseTo(1000 / 60);
        });

        it("estimates the interval for the target fps \"auto\"", () => {
            const d = createAutoMonitor("auto");
            d.frames(8, 3);

            expect(d.monitor.getFrameIntervalMs()).toBe(8);
        });

        it("accepts a delta of 4 ms as a frame interval", () => {
            const d = createAutoMonitor();
            d.frames(4, 5);

            expect(d.monitor.getFrameIntervalMs()).toBe(4);
        });

        it("follows a change from 60 Hz to 120 Hz at the first short delta", () => {
            const d = createAutoMonitor();
            d.frames(16, 10);
            d.frames(8, 1);

            expect(d.monitor.getFrameIntervalMs()).toBe(8);
        });

        it("follows a change from 120 Hz to 60 Hz after 600 frames", () => {
            const d = createAutoMonitor();
            // The first frame sets the start, and the second frame gives one delta of 8 ms
            d.frames(8, 2);
            d.frames(16, 599);
            expect(d.monitor.getFrameIntervalMs()).toBe(8);

            d.frames(16, 1);
            expect(d.monitor.getFrameIntervalMs()).toBe(16);
        });

        it("logs an error from the report function and continues with the next frame", () => {
            const d = createAutoMonitor();
            d.report.mockImplementationOnce(() => { throw new Error("export failed"); });
            d.frames(16, 3);

            expect(d.logger.log).toHaveBeenCalledWith("error", "Error in frame timing measurement.", { error : expect.any(Error), type : "FrameTimingMonitor" });
            expect(d.report).toHaveBeenCalledTimes(2);
        });
    });
});
