import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClockDriftMonitor, type ClockDriftOptions } from "./ClockDriftMonitor.js";
import { createAbsoluteClock } from "./absolute-clock.js";

const TIME_ORIGIN = 1_700_000_000_000;

/**
 * Fake clocks on Vitest's fake timers. `advance(ms)` moves the monotonic
 * clock and the timers. `wallExtra` moves only the wall clock. `late` delays
 * the timer, as a blocked main thread or a Windows sleep does.
 */
function createMonitor(options : ClockDriftOptions = {}) {
    let mono = 0;
    let wall = TIME_ORIGIN;
    /** Extra time that each read of the monotonic clock adds (the thread stopped between reads). */
    let readSpread = 0;
    const report = vi.fn();
    const onJump = vi.fn();
    const logger = { log : vi.fn() };
    const performance = {
        timeOrigin : TIME_ORIGIN,
        now : () => {
            const value = mono;
            mono += readSpread;
            return value;
        },
    };
    const monitor = new ClockDriftMonitor(
        report,
        onJump,
        logger,
        createAbsoluteClock(performance),
        { now : () => wall },
        (fn, ms) => setInterval(fn, ms) as unknown as number,
        (id) => clearInterval(id),
        options,
    );
    return {
        monitor, report, onJump, logger,
        advance(ms : number, wallExtra = 0) {
            mono += ms;
            wall += ms + wallExtra;
            vi.advanceTimersByTime(ms);
        },
        /** The next timer callback runs `ms` late: both clocks move, and the callback runs once. */
        late(ms : number) {
            mono += ms;
            wall += ms;
        },
        setReadSpread(ms : number) { readSpread = ms; },
    };
}

describe("ClockDriftMonitor", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("samples every second by default and reports a skew near 0 while both clocks agree", () => {
        const m = createMonitor();
        m.advance(1_000);
        expect(m.report).toHaveBeenCalledWith({ skewMs : 0, driftMs : 0, intervalMs : 1_000 });
        expect(m.onJump).not.toHaveBeenCalled();
    });

    it("tolerates gradual correction of the wall clock", () => {
        const m = createMonitor();
        // 40 ms each second is below the 50 ms minimum
        m.advance(1_000, 40);
        m.advance(1_000, 40);
        expect(m.report).toHaveBeenLastCalledWith({ skewMs : 80, driftMs : 40, intervalMs : 1_000 });
        expect(m.onJump).not.toHaveBeenCalled();
    });

    it("scales the threshold with the interval: 3% of the time between samples", () => {
        const m = createMonitor({ intervalMs : 60_000 });
        // 1.5 s in 60 s is below 3% (1.8 s)
        m.advance(60_000, 1_500);
        expect(m.onJump).not.toHaveBeenCalled();
        m.advance(60_000, 2_000);
        expect(m.onJump).toHaveBeenCalledWith(expect.objectContaining({ direction : "forward", magnitudeMs : 2_000, kind : "suspend" }));
    });

    it("classifies a forward jump of 1 s or more with an on-time timer as a suspend", () => {
        const m = createMonitor();
        m.advance(1_000, 3_600_000);
        expect(m.onJump).toHaveBeenCalledWith({
            direction : "forward",
            kind : "suspend",
            magnitudeMs : 3_600_000,
            skewMs : 3_600_000,
            latenessMs : 0,
        });
    });

    it("classifies a smaller forward jump as a step", () => {
        const m = createMonitor();
        m.advance(1_000, 300);
        expect(m.onJump).toHaveBeenCalledWith(expect.objectContaining({ direction : "forward", kind : "step", magnitudeMs : 300 }));
    });

    it("classifies a backward jump as a step", () => {
        const m = createMonitor();
        m.advance(1_000, -2_000);
        expect(m.onJump).toHaveBeenCalledWith({ direction : "backward", kind : "step", magnitudeMs : 2_000, skewMs : -2_000, latenessMs : 0 });
    });

    it("classifies a forward jump during a late timer as a step, not a suspend", () => {
        const m = createMonitor();
        m.late(10_000);
        m.advance(1_000, 5_000);
        expect(m.onJump).toHaveBeenCalledWith(expect.objectContaining({ kind : "step", latenessMs : 10_000 }));
    });

    it("finds no discontinuity when both clocks continue, as in a Windows sleep or a blocked thread", () => {
        const m = createMonitor();
        m.late(60_000);
        m.advance(1_000);
        expect(m.onJump).not.toHaveBeenCalled();
        expect(m.report).toHaveBeenLastCalledWith({ skewMs : 0, driftMs : 0, intervalMs : 61_000 });
    });

    it("ignores a sample when the thread stopped between the two reads of the monotonic clock", () => {
        const m = createMonitor();
        m.setReadSpread(5);
        m.advance(1_000, 10_000);
        expect(m.report).not.toHaveBeenCalled();
        expect(m.onJump).not.toHaveBeenCalled();

        // The next accurate sample compares with the last accurate one
        m.setReadSpread(0);
        m.advance(1_000);
        expect(m.onJump).toHaveBeenCalledWith(expect.objectContaining({ direction : "forward" }));
    });

    it("measures drift from the restart, not across a stopped period", () => {
        const m = createMonitor();
        m.monitor.stop();
        m.advance(5_000, 10_000);
        m.monitor.start();
        m.advance(1_000);
        expect(m.onJump).not.toHaveBeenCalled();
        expect(m.monitor.getSkewMs()).toBe(10_000);
    });

    it("stops its timer", () => {
        const m = createMonitor();
        m.monitor.stop();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("logs instead of throwing when report throws", () => {
        const m = createMonitor();
        m.report.mockImplementation(() => { throw new Error("boom"); });
        m.advance(1_000);
        expect(m.logger.log).toHaveBeenCalledWith("error", "Error in clock drift measurement.", expect.anything());
    });
});
