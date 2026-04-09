import { vi, expect } from "vitest";
import {
    SchedulingFairnessMonitor,
    type MessageChannelLike,
    type MessageChannelConstructor,
    type SchedulingMeasurement,
} from "./SchedulingFairnessMonitor.js";

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
            (() => createMockMessageChannel()) as unknown as MessageChannelConstructor,
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
                    cb : () => channel.port1.onmessage?.({ data : null }),
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

        // Trigger the interval callback to enqueue all three primitives
        const intervalCallback = setIntervalFn.mock.calls[0]![0] as () => void;
        intervalCallback();

        // Drain in priority order: microtask first (simulates spec semantics),
        // then messagechannel, then macrotask. Each step advances the clock.
        const drain = (kind : string, advance : number) : void => {
            const queued = queuedCallbacks.find((q) => q.kind === kind);
            if (!queued) return;
            currentTime += advance;
            queued.cb();
        };
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
            (() => createMockMessageChannel()) as unknown as MessageChannelConstructor,
            { now : () => 0 },
        );

        monitor.stop();
        expect(clearIntervalFn).toHaveBeenCalledWith(42);
    });

    it("logs an error when measurement throws", () => {
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

        const cb = setIntervalFn.mock.calls[0]![0] as () => void;
        cb();

        expect(logger.log).toHaveBeenCalledWith(
            "error",
            "Error in scheduling fairness measurement.",
            expect.objectContaining({ type : "SchedulingFairnessMonitor" }),
        );
    });
});
