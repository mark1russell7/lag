import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClockDriftMonitor } from "./ClockDriftMonitor.js";

function createMonitor() {
    let mono = 0;
    let wall = 1_700_000_000_000;
    const timeOrigin = 1_700_000_000_000;
    const report = vi.fn();
    const onJump = vi.fn();
    const logger = { log : vi.fn() };
    const monitor = new ClockDriftMonitor(
        report,
        onJump,
        logger,
        { timeOrigin, now : () => mono },
        { now : () => wall },
        (fn, ms) => setInterval(fn, ms) as unknown as number,
        (id) => clearInterval(id),
        1_000,
        500,
    );
    return {
        monitor, report, onJump, logger,
        /** Advance both clocks; `wallExtra` moves only the wall clock. */
        advance(ms : number, wallExtra = 0) {
            mono += ms;
            wall += ms + wallExtra;
            vi.advanceTimersByTime(ms);
        },
    };
}

describe("ClockDriftMonitor", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("reports a skew near 0 while both clocks agree", () => {
        const m = createMonitor();
        m.advance(1_000);
        expect(m.report).toHaveBeenCalledWith({ skewMs : 0, driftMs : 0 });
        expect(m.onJump).not.toHaveBeenCalled();
    });

    it("reports slow drift without a jump", () => {
        const m = createMonitor();
        m.advance(1_000, 2);
        m.advance(1_000, 2);
        expect(m.report).toHaveBeenLastCalledWith({ skewMs : 4, driftMs : 2 });
        expect(m.onJump).not.toHaveBeenCalled();
    });

    it("reports a forward jump, for example after a sleep that stopped the monotonic clock", () => {
        const m = createMonitor();
        m.advance(1_000, 3_600_000);
        expect(m.onJump).toHaveBeenCalledWith({ direction : "forward", magnitudeMs : 3_600_000, skewMs : 3_600_000 });
    });

    it("reports a backward jump of the wall clock", () => {
        const m = createMonitor();
        m.advance(1_000, -2_000);
        expect(m.onJump).toHaveBeenCalledWith({ direction : "backward", magnitudeMs : 2_000, skewMs : -2_000 });
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
