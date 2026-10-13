import { describe, expect, it } from "vitest";
import {
    driftWindows,
    FOUR_LAGS_SETTINGS,
    fourLags,
    frameSlots,
    heartbeats,
    longestFrameGap,
    meanRandomWait,
    nextFrame,
    rateInp,
    startOf,
    type BusyPeriod,
} from "./four-lags";

const settings = FOUR_LAGS_SETTINGS;
const frame = settings.frameIntervalMs;

/** A long task that entered the queue at its start. */
function task(start : number, end : number, queued = start) : BusyPeriod {
    return { start, end, queued, kind : "task" };
}

describe("startOf", () => {
    it("gives the time itself when the main thread is free", () => {
        expect(startOf([task(100, 400)], 50)).toBe(50);
        expect(startOf([task(100, 400)], 400)).toBe(400);
    });

    it("waits for the task that runs, and for each task that entered the queue first", () => {
        expect(startOf([task(100, 400)], 100)).toBe(400);
        // The handlers of a click at 200 ms run after the long task
        const busy = [task(100, 400), task(400, 412, 200)];
        expect(startOf(busy, 250)).toBe(412);
        expect(startOf(busy, 150)).toBe(400);
        expect(startOf([task(100, 400), task(500, 512)], 250)).toBe(400);
    });
});

describe("frames", () => {
    it("rounds up to the next rendering opportunity", () => {
        expect(nextFrame(0, frame)).toBe(0);
        expect(nextFrame(1, frame)).toBeCloseTo(frame);
        expect(nextFrame(3 * frame, frame)).toBeCloseTo(3 * frame);
    });

    it("drops the frames of a busy period and presents the first frame after it", () => {
        const slots = frameSlots([task(100, 400)], settings);
        const presentedAround = slots.filter(slot => slot.time > 90 && slot.time < 420).map(slot => [Math.round(slot.time), slot.presented]);
        expect(presentedAround[0]).toEqual([100, false]);
        expect(presentedAround.at(-1)).toEqual([417, true]);
        expect(slots.filter(slot => !slot.presented)).toHaveLength(18);
    });

    it("counts a gap of n frame intervals as n − 1 dropped frames", () => {
        const slots = frameSlots([task(100, 400)], settings);
        const gap = longestFrameGap(slots, frame);
        expect(gap.start).toBeCloseTo(5 * frame);
        expect(gap.end).toBeCloseTo(24 * frame);
        expect(gap.ms).toBeCloseTo(19 * frame);
        expect(gap.dropped).toBe(18);
    });

    it("gives one frame interval without a busy period", () => {
        const gap = longestFrameGap(frameSlots([], settings), frame);
        expect(gap.ms).toBeCloseTo(frame);
        expect(gap.dropped).toBe(0);
    });
});

describe("driftWindows", () => {
    it("gives windows of 100 ms without lag on an idle main thread", () => {
        const windows = driftWindows([], settings);
        expect(windows).toHaveLength(10);
        expect(windows.every(window => window.lagMs === 0)).toBe(true);
    });

    it("gives the lag of a block to the window that contains it, less up to one step", () => {
        const windows = driftWindows([task(102, 402)], settings);
        const late = windows.filter(window => window.lagMs > 0);
        expect(late).toHaveLength(1);
        // The step after 100 ms is due at 105 ms. It starts at 402 ms, thus the lag is 297 ms
        expect(late[0]).toEqual({ start : 100, end : 497, lagMs : 297 });
    });
});

describe("heartbeats", () => {
    it("makes the heartbeats wait until the end of the busy period", () => {
        const beats = heartbeats([task(100, 400)], settings);
        expect(beats.map(beat => beat.sent)).toEqual([40, 140, 240, 340, 440, 540, 640, 740, 840, 940]);
        expect(beats.map(beat => beat.waitMs)).toEqual([0, 260, 160, 60, 0, 0, 0, 0, 0, 0]);
    });

    it("gives the mean wait of a message at a random time", () => {
        // 300 ms of 1000 ms are busy, and a message in them waits 150 ms on average
        expect(meanRandomWait([task(100, 400)], 1000)).toBeCloseTo(45);
        expect(meanRandomWait([], 1000)).toBe(0);
        // Two tasks in the queue at the same time: a message waits for both
        expect(meanRandomWait([task(100, 300), task(300, 400, 100)], 1000)).toBeCloseTo(45);
        // The second task enters the queue at 300 ms: a message before it waits only for the first task
        expect(meanRandomWait([task(100, 300), task(300, 400)], 1000)).toBeCloseTo(25);
    });
});

describe("fourLags", () => {
    it("calculates the example of the event loop page: a block of 300 ms and a click 100 ms after its start", () => {
        const result = fourLags({ taskStartMs : 100, taskDurationMs : 300, clickMs : 200 });
        expect(result.task).toEqual({ start : 100, end : 400 });
        expect(result.click).toMatchObject({ inputDelayMs : 200, processingMs : 12, handlerStart : 400, handlerEnd : 412 });
        expect(result.click!.paint).toBeCloseTo(25 * frame);
        expect(result.click!.durationMs).toBeCloseTo(25 * frame - 200);
        expect(result.click!.rating).toBe("needs-improvement");
        // The step that is due at 100 ms starts at 400 ms (300 ms), and the next step waits for the handlers (7 ms)
        expect(result.blockedMs).toBeCloseTo(307);
        expect(result.lateWindows).toBe(2);
        expect(result.longestWaitMs).toBe(260);
        expect(result.waitingHeartbeats).toBe(3);
    });

    it("gives no input latency when nobody clicks, but the same blocked time and frame gap", () => {
        const withClick = fourLags({ taskStartMs : 100, taskDurationMs : 300, clickMs : 600 });
        const without = fourLags({ taskStartMs : 100, taskDurationMs : 300, clickMs : undefined });
        expect(without.click).toBeUndefined();
        expect(without.frameGap.ms).toBeCloseTo(withClick.frameGap.ms);
        expect(without.blockedMs).toBeCloseTo(300);
        expect(without.busy).toEqual([task(100, 400)]);
    });

    it("changes the other three values by less than 20 ms when the click moves (the claim of the event loop page)", () => {
        for (const durationMs of [50, 300, 700]) {
            const without = fourLags({ taskStartMs : 150, taskDurationMs : durationMs, clickMs : undefined });
            const latencies : number[] = [];
            for (let clickMs = 0; clickMs <= 980; clickMs += 5) {
                const result = fourLags({ taskStartMs : 150, taskDurationMs : durationMs, clickMs });
                latencies.push(result.click!.durationMs);
                expect(Math.abs(result.blockedMs - without.blockedMs)).toBeLessThan(20);
                expect(Math.abs(result.longestWaitMs - without.longestWaitMs)).toBeLessThan(20);
                expect(Math.abs(result.frameGap.ms - without.frameGap.ms)).toBeLessThan(20);
            }
            expect(Math.max(...latencies) - Math.min(...latencies)).toBeGreaterThan(durationMs - 20);
        }
    });

    it("gives a short click latency for a click after the task", () => {
        const result = fourLags({ taskStartMs : 100, taskDurationMs : 300, clickMs : 600 });
        expect(result.click!.inputDelayMs).toBe(0);
        expect(result.click!.durationMs).toBeLessThan(30);
        expect(result.click!.rating).toBe("good");
    });

    it("makes the long task wait for the handlers of a click that comes just before it", () => {
        const result = fourLags({ taskStartMs : 100, taskDurationMs : 300, clickMs : 95 });
        expect(result.click).toMatchObject({ inputDelayMs : 0, handlerStart : 95, handlerEnd : 107 });
        expect(result.task).toEqual({ start : 107, end : 407 });
        // The long task starts before the next frame, thus the click waits for it in its presentation delay
        expect(result.click!.paint).toBeCloseTo(25 * frame);
        expect(result.click!.presentationMs).toBeCloseTo(25 * frame - 107);
    });

    it("rates the click with the INP thresholds", () => {
        expect(rateInp(200, settings.inp)).toBe("good");
        expect(rateInp(201, settings.inp)).toBe("needs-improvement");
        expect(rateInp(500, settings.inp)).toBe("needs-improvement");
        expect(rateInp(501, settings.inp)).toBe("poor");
        const poor = fourLags({ taskStartMs : 100, taskDurationMs : 700, clickMs : 110 });
        expect(poor.click!.rating).toBe("poor");
    });

    it("gives a task of 0 ms no busy period", () => {
        const result = fourLags({ taskStartMs : 100, taskDurationMs : 0, clickMs : undefined });
        expect(result.busy).toEqual([]);
        expect(result.blockedMs).toBe(0);
        expect(result.longestWaitMs).toBe(0);
        expect(result.frameGap.dropped).toBe(0);
    });
});
