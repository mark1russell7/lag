import { describe, expect, it } from "vitest";
import { BusyTimeProbe } from "./BusyTimeProbe.js";
import { SimulatedThread } from "./test-thread.js";

/** A probe whose messages start only when the test calls `deliver()`, at the time of `clock.now`. */
function createManualProbe() {
    const clock = { now : 0 };
    const pending : Array<() => void> = [];
    const probe = new BusyTimeProbe((callback) => pending.push(callback), { now : () => clock.now });
    return {
        probe,
        clock,
        pending,
        /** This function starts the oldest message at the time `at`. */
        deliver(at : number) {
            clock.now = at;
            pending.shift()?.();
        },
    };
}

describe("BusyTimeProbe", () => {
    it("measures no busy time on an idle thread", () => {
        const thread = new SimulatedThread(1 / 64);
        const probe = new BusyTimeProbe(thread.post, thread.clock);

        probe.start();
        thread.advance(16);

        expect(probe.stop()).toBe(0);
        // The chain operated during the full interval: one message for each task of 1/64 ms
        expect(thread.postedMessages).toBeGreaterThan(16 * 64);
    });

    it("measures the tasks that keep the thread busy: each task delays one message", () => {
        const thread = new SimulatedThread(1 / 64);
        const probe = new BusyTimeProbe(thread.post, thread.clock);

        probe.start();
        thread.setTimeout(() => thread.busy(10), 3);
        thread.setTimeout(() => thread.busy(5), 20);
        thread.advance(40);

        // Each wait also contains the cost of one task (1/64 ms)
        const busyMs = probe.stop();
        expect(busyMs).toBeGreaterThanOrEqual(15);
        expect(busyMs).toBeLessThan(15.1);
    });

    it("counts the wait of the message that did not start when it stops", () => {
        const thread = new SimulatedThread(1 / 64);
        const probe = new BusyTimeProbe(thread.post, thread.clock);
        let busyMs = -1;

        probe.start();
        // The two timers are ready at the same time. The second timer starts after the busy task,
        // before the message that waits.
        thread.setTimeout(() => thread.busy(8), 2);
        thread.setTimeout(() => { busyMs = probe.stop(); }, 2);
        thread.advance(20);

        expect(busyMs).toBeCloseTo(8, 1);
        expect(probe.isRunning()).toBe(false);
    });

    it("counts only the waits of more than 2 ms", () => {
        const m = createManualProbe();

        m.probe.start();
        m.deliver(2);
        m.deliver(4.5);
        m.clock.now = 6.5;

        // The waits are 2 ms, 2.5 ms and 2 ms (the message that did not start)
        expect(m.probe.stop()).toBe(2.5);
    });

    it("gives 0 without a measurement, and after a measurement stopped", () => {
        const m = createManualProbe();
        expect(m.probe.isRunning()).toBe(false);
        m.clock.now = 3;
        expect(m.probe.stop()).toBe(0);
        m.clock.now = 0;

        m.probe.start();
        m.clock.now = 5;
        expect(m.probe.stop()).toBe(5);
        m.clock.now = 10;
        expect(m.probe.stop()).toBe(0);
    });

    it("ignores a message of an earlier measurement", () => {
        const m = createManualProbe();

        m.probe.start();
        expect(m.probe.isRunning()).toBe(true);
        m.probe.stop();
        m.probe.start();
        expect(m.pending).toHaveLength(2);

        // The message of the first measurement starts late, but it does not count and it posts no message
        m.deliver(50);
        expect(m.pending).toHaveLength(1);
        m.deliver(50);
        expect(m.pending).toHaveLength(1);
        expect(m.probe.stop()).toBe(50);
    });

    it("starts again from 0 when start() comes during a measurement", () => {
        const m = createManualProbe();

        m.probe.start();
        m.deliver(10);
        m.probe.start();
        m.clock.now = 12;

        expect(m.probe.stop()).toBe(0);
    });

    it("stops the chain: after stop(), a message posts no other message", () => {
        const m = createManualProbe();

        m.probe.start();
        m.probe.stop();
        m.deliver(3);

        expect(m.pending).toHaveLength(0);
    });
});
