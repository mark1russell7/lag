import { describe, expect, it } from "vitest";
import {
    clampViewport,
    DEFAULT_SPAN,
    fitViewport,
    followViewport,
    formatTick,
    LIVE_MARGIN,
    MIN_SPAN,
    panViewport,
    tickStep,
    timeTicks,
    timeToX,
    xToTime,
    zoomViewport,
} from "./viewport";

const bounds = { start : -5, end : 100 };

describe("clampViewport", () => {
    it("keeps a range in the bounds, with a small space after the present time", () => {
        expect(clampViewport({ start : -20, end : -10 }, bounds)).toEqual({ start : -5, end : 5 });
        const right = clampViewport({ start : 95, end : 105 }, bounds);
        expect(right.end).toBeCloseTo(100 + 10 * LIVE_MARGIN);
        expect(right.end - right.start).toBeCloseTo(10);
    });

    it("limits the length to the minimum and to all the data", () => {
        const short = clampViewport({ start : 10, end : 10.001 }, bounds);
        expect(short.end - short.start).toBeCloseTo(MIN_SPAN);
        expect(clampViewport({ start : -100, end : 400 }, bounds)).toEqual({ start : -5, end : 100 });
    });

    it("starts a range that is longer than a short session at the start of the data", () => {
        expect(clampViewport({ start : -20, end : 10 }, { start : -1, end : 4 })).toEqual({ start : -1, end : -1 + DEFAULT_SPAN });
    });
});

describe("zoomViewport", () => {
    it("keeps the anchor at the same place on the screen", () => {
        const viewport = { start : 10, end : 30 };
        const zoomed = zoomViewport(viewport, 0.5, 15, bounds);
        expect(zoomed).toEqual({ start : 12.5, end : 22.5 });
        expect((15 - zoomed.start) / (zoomed.end - zoomed.start)).toBeCloseTo((15 - viewport.start) / (viewport.end - viewport.start));
    });

    it("zooms out to all the data at most", () => {
        expect(zoomViewport({ start : 10, end : 30 }, 100, 20, bounds)).toEqual({ start : -5, end : 100 });
    });
});

describe("panViewport", () => {
    it("moves the range and stops at the bounds", () => {
        expect(panViewport({ start : 10, end : 20 }, 5, bounds)).toEqual({ start : 15, end : 25 });
        expect(panViewport({ start : 10, end : 20 }, -50, bounds)).toEqual({ start : -5, end : 5 });
    });
});

describe("followViewport", () => {
    it("shows the present time near the right edge", () => {
        const followed = followViewport({ start : 0, end : 30 }, 90);
        expect(followed.end).toBeCloseTo(90 + 30 * LIVE_MARGIN);
        expect(followed.end - followed.start).toBeCloseTo(30);
    });

    it("starts at the earliest data while the session is shorter than the range", () => {
        expect(followViewport({ start : 0, end : 30 }, 4, -1)).toEqual({ start : -1, end : 29 });
    });
});

describe("fitViewport", () => {
    it("shows all data", () => {
        expect(fitViewport(bounds)).toEqual({ start : -5, end : 100 });
    });
});

describe("time and pixels", () => {
    it("converts in both directions", () => {
        const viewport = { start : 10, end : 20 };
        expect(timeToX(15, viewport, 400)).toBe(200);
        expect(xToTime(100, viewport, 400)).toBe(12.5);
    });
});

describe("ticks", () => {
    it("uses steps of 1, 2 or 5 multiplied by a power of 10", () => {
        expect(tickStep({ start : 0, end : 30 }, 1200)).toBe(5);
        expect(tickStep({ start : 0, end : 1 }, 1200)).toBe(0.1);
        expect(tickStep({ start : 0, end : 0.05 }, 1000)).toBe(0.005);
    });

    it("formats the ticks with the decimals of the step and a minus sign", () => {
        expect(formatTick(12, 5)).toBe("12 s");
        expect(formatTick(12.5, 0.5)).toBe("12.5 s");
        expect(formatTick(-5, 5)).toBe("−5 s");
        expect(formatTick(1e-12, 0.1)).toBe("0.0 s");
    });

    it("puts a tick at each multiple of the step in the range", () => {
        expect(timeTicks({ start : -0.5, end : 10.5 }, 1200).map(tick => tick.label)).toEqual(["0 s", "1 s", "2 s", "3 s", "4 s", "5 s", "6 s", "7 s", "8 s", "9 s", "10 s"]);
    });
});
