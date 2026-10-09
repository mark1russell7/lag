import { vi, expect } from "vitest";
import {
    SchedulingFairnessMonitor,
    type MessageChannelLike,
    type MessageChannelConstructor,
    type MessagePortLike,
    type SchedulingMeasurement,
} from "./SchedulingFairnessMonitor.js";
import { SimulatedThread } from "./test-thread.js";

/** A MessageChannel on the simulated thread: each message is a task of the thread. */
function threadChannel(thread : SimulatedThread) : MessageChannelConstructor {
    return class {
        readonly port1 : MessagePortLike = { postMessage : () => {}, onmessage : null };
        readonly port2 : MessagePortLike = {
            postMessage : () => thread.post(() => (this.port1.onmessage as (() => void) | null)?.()),
            onmessage : null,
        };
    } as unknown as MessageChannelConstructor;
}

function createMockMessageChannel() {
    let onmessage : ((event : { data : unknown }) => void) | null = null;
    const port1 = {
        postMessage : vi.fn(),
        get onmessage() { return onmessage; },
        set onmessage(cb : ((event : { data : unknown }) => void) | null) { onmessage = cb; },
        start : vi.fn(),
        close : vi.fn(),
    };
    const port2 = {
        postMessage : vi.fn((data : unknown) => {
            // Simulate the channel: port2.postMessage triggers port1.onmessage
            if (onmessage) onmessage({ data });
        }),
        onmessage : null,
        start : vi.fn(),
        close : vi.fn(),
    };
    const channel : MessageChannelLike = { port1, port2 };
    return channel;
}

describe("SchedulingFairnessMonitor", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("starts measurement loop on construction", () => {
        const setInterval = vi.fn();
        const logger = { log : vi.fn() };

        new SchedulingFairnessMonitor(
            1000,
            vi.fn(),
            logger,
            setInterval as never,
            vi.fn(),
            vi.fn(),
            vi.fn(),
            function () { return createMockMessageChannel(); } as unknown as MessageChannelConstructor,
            { now : () => 0 },
        );

        expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 1000);
    });

    it("reports a SchedulingMeasurement when all three primitives complete", () => {
        // We capture the start time, then deferred callbacks fire in order with
        // each one advancing the clock by a known amount. This simulates real
        // scheduling latency without timing flakiness.
        let currentTime = 100;
        const clock = { now : () => currentTime };
        const setIntervalFn = vi.fn();
        const reports : SchedulingMeasurement[] = [];

        const queuedCallbacks : Array<{ kind : string; cb : () => void }> = [];

        const setTimeoutFn = vi.fn((cb : () => void) => {
            queuedCallbacks.push({ kind : "macrotask", cb });
            return 0 as never;
        });
        const queueMicrotaskFn = vi.fn((cb : () => void) => {
            queuedCallbacks.push({ kind : "microtask", cb });
        });
        const MockChannel = function () {
            const channel = createMockMessageChannel();
            // Override port2.postMessage to defer instead of fire synchronously
            channel.port2.postMessage = vi.fn(() => {
                queuedCallbacks.push({
                    kind : "messagechannel",
                    cb : () => (channel.port1.onmessage as ((event : { data : unknown }) => void) | null)?.({ data : null }),
                });
            });
            return channel;
        } as unknown as MessageChannelConstructor;

        const monitor = new SchedulingFairnessMonitor(
            1000,
            (m) => reports.push(m),
            { log : vi.fn() },
            setIntervalFn as never,
            vi.fn(),
            setTimeoutFn,
            queueMicrotaskFn,
            MockChannel,
            clock,
        );

        // The interval callback only posts the message task that starts the cycle
        const intervalCallback = setIntervalFn.mock.calls[0]![0] as () => void;
        intervalCallback();
        expect(queuedCallbacks.map(q => q.kind)).toEqual(["messagechannel"]);
        expect(setTimeoutFn).not.toHaveBeenCalled();

        // Run one queued callback of a kind. Each step advances the clock.
        const drain = (kind : string, advance : number) : void => {
            const index = queuedCallbacks.findIndex((q) => q.kind === kind);
            if (index < 0) return;
            const [queued] = queuedCallbacks.splice(index, 1);
            currentTime += advance;
            queued!.cb();
        };
        // The message task starts the three measurements (at the time 110)
        drain("messagechannel", 10);
        expect(queuedCallbacks.map(q => q.kind).sort()).toEqual(["macrotask", "messagechannel", "microtask"]);

        // Drain in priority order: microtask first (simulates spec semantics),
        // then messagechannel, then macrotask.
        drain("microtask",      0.5);
        drain("messagechannel", 1.0);
        drain("macrotask",      4.0);

        expect(reports).toHaveLength(1);
        expect(reports[0]!.microtaskMs).toBeCloseTo(0.5);
        expect(reports[0]!.messageChannelMs).toBeCloseTo(1.5);
        expect(reports[0]!.macrotaskMs).toBeCloseTo(5.5);

        monitor.stop();
    });

    it("stops the measurement loop on stop()", () => {
        const setIntervalFn = vi.fn(() => 42);
        const clearIntervalFn = vi.fn();

        const monitor = new SchedulingFairnessMonitor(
            1000,
            vi.fn(),
            { log : vi.fn() },
            setIntervalFn as never,
            clearIntervalFn,
            vi.fn(),
            vi.fn(),
            function () { return createMockMessageChannel(); } as unknown as MessageChannelConstructor,
            { now : () => 0 },
        );

        monitor.stop();
        expect(clearIntervalFn).toHaveBeenCalledWith(42);
    });

    it("logs an error and does not start when the MessageChannel cannot be constructed", () => {
        const setIntervalFn = vi.fn();
        const logger = { log : vi.fn() };
        const ThrowingChannel = (function () {
            throw new Error("MessageChannel unavailable");
        }) as unknown as MessageChannelConstructor;

        new SchedulingFairnessMonitor(
            1000,
            vi.fn(),
            logger,
            setIntervalFn as never,
            vi.fn(),
            vi.fn(),
            vi.fn(),
            ThrowingChannel,
            { now : () => 0 },
        );

        expect(setIntervalFn).not.toHaveBeenCalled();
        expect(logger.log).toHaveBeenCalledWith(
            "error",
            "Error in scheduling fairness measurement.",
            expect.objectContaining({ type : "SchedulingFairnessMonitor" }),
        );
    });

    it("drops a cycle that was still in flight across stop() and start()", () => {
        let intervalCallback = () => {};
        const timeouts : Array<() => void> = [];
        const report = vi.fn();

        const monitor = new SchedulingFairnessMonitor(
            1000,
            report,
            { log : vi.fn() },
            ((cb : () => void) => { intervalCallback = cb; return 1; }) as never,
            vi.fn(),
            ((cb : () => void) => { timeouts.push(cb); return 2; }) as never,
            (cb : () => void) => cb(),
            function () { return createMockMessageChannel(); } as unknown as MessageChannelConstructor,
            { now : () => 0 },
        );

        // Control: an undisturbed cycle reports
        intervalCallback();
        timeouts[0]!();
        expect(report).toHaveBeenCalledTimes(1);

        intervalCallback(); // microtask + channel complete; setTimeout(0) still pending
        monitor.stop();     // page hidden...
        monitor.start();    // ...and visible again
        timeouts[1]!();     // the throttled setTimeout finally fires

        expect(report).toHaveBeenCalledTimes(1);
    });

    it("starts setTimeout(0) from a message task, not from the setInterval callback", () => {
        const order : string[] = [];
        let intervalCallback = () => {};
        let deliver : (() => void) | undefined;
        const Channel = function () {
            const channel = createMockMessageChannel();
            channel.port2.postMessage = vi.fn(() => {
                deliver = () => (channel.port1.onmessage as ((event : { data : unknown }) => void) | null)?.({ data : null });
            });
            return channel;
        } as unknown as MessageChannelConstructor;

        new SchedulingFairnessMonitor(
            1000,
            vi.fn(),
            { log : vi.fn() },
            ((cb : () => void) => { intervalCallback = cb; return 1; }) as never,
            vi.fn(),
            (() => { order.push("setTimeout"); return 2; }) as never,
            vi.fn(),
            Channel,
            { now : () => 0 },
        );

        intervalCallback();
        order.push("interval callback returned");
        deliver!();

        expect(order).toEqual(["interval callback returned", "setTimeout"]);
    });

    it("closes its channel on stop()", () => {
        const channels : MessageChannelLike[] = [];
        const monitor = new SchedulingFairnessMonitor(
            1000,
            vi.fn(),
            { log : vi.fn() },
            (() => 1) as never,
            vi.fn(),
            vi.fn(),
            vi.fn(),
            function () { const c = createMockMessageChannel(); channels.push(c); return c; } as unknown as MessageChannelConstructor,
            { now : () => 0 },
        );

        monitor.stop();
        expect(channels).toHaveLength(1);
        expect(channels[0]!.port1.close).toHaveBeenCalled();
        expect(channels[0]!.port1.onmessage).toBeNull();
    });

    describe("rules of the measurement loop", () => {
        /** A constructor that gives the ports of one mock channel. */
        function channelClass() : MessageChannelConstructor {
            const channel = createMockMessageChannel();
            return class { port1 = channel.port1; port2 = channel.port2; } as unknown as MessageChannelConstructor;
        }

        function createMonitor(MessageChannelCtor : MessageChannelConstructor = channelClass(), setTimeoutFn = (fn : () => void, ms : number) => setTimeout(fn, ms) as unknown as number) {
            const logger = { log : vi.fn() };
            const setIntervalFn = vi.fn((fn : () => void, ms : number) => setInterval(fn, ms) as unknown as number);
            const monitor = new SchedulingFairnessMonitor(
                1_000,
                vi.fn(),
                logger,
                setIntervalFn,
                (id) => clearInterval(id),
                setTimeoutFn,
                (cb) => queueMicrotask(cb),
                MessageChannelCtor,
                { now : () => Date.now() },
            );
            return { monitor, logger, setIntervalFn };
        }

        it("start() while the monitor operates adds no second interval", () => {
            const m = createMonitor();
            m.monitor.start();
            m.monitor.stop();

            expect(m.setIntervalFn).toHaveBeenCalledTimes(1);
            expect(vi.getTimerCount()).toBe(0);
        });

        it("stop() works after a start that could not make the MessageChannel", () => {
            const Broken = class { constructor() { throw new Error("no MessageChannel"); } } as unknown as MessageChannelConstructor;
            const m = createMonitor(Broken);

            expect(() => m.monitor.stop()).not.toThrow();
        });

        // This test found a library bug. The callback of the last primitive called report() outside
        // the try/catch of the cycle. Thus an error of report() went into the task of the browser.
        it("logs an error when the report function throws, and continues with the next cycle", () => {
            const thread = new SimulatedThread();
            const logger = { log : vi.fn() };
            const report = vi.fn(() => { throw new Error("report failed"); });
            const monitor = new SchedulingFairnessMonitor(
                1_000,
                report,
                logger,
                thread.setInterval,
                thread.clearInterval,
                thread.setTimeout,
                // The simulated thread has no microtask queue: the microtask starts at once
                (cb) => cb(),
                threadChannel(thread),
                thread.clock,
            );

            expect(() => thread.advance(2_100)).not.toThrow();
            monitor.stop();
            expect(report).toHaveBeenCalledTimes(2);
            expect(logger.log).toHaveBeenCalledWith("error", "Error in scheduling fairness measurement.", { error : expect.any(Error), type : "SchedulingFairnessMonitor" });
        });

        it("logs an error when a cycle cannot start, and continues with the next cycle", () => {
            const setTimeoutFn = vi.fn((fn : () => void, ms : number) => setTimeout(fn, ms) as unknown as number);
            setTimeoutFn.mockImplementationOnce(() => { throw new Error("no timers"); });
            const m = createMonitor(channelClass(), setTimeoutFn);
            vi.advanceTimersByTime(2_000);
            m.monitor.stop();

            expect(m.logger.log).toHaveBeenCalledWith("error", "Error in scheduling fairness measurement.", { error : expect.any(Error), type : "SchedulingFairnessMonitor" });
            expect(setTimeoutFn).toHaveBeenCalledTimes(2);
        });
    });
});
