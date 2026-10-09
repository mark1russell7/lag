import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createForwardingMeter, createMeterReceiver, type ForwardedMetricMessage } from "./forwarding-meter.js";
import { createRecordingMeter } from "./test-utils.js";

function createPair(options : { flushIntervalMs? : number; maxBufferedRecords? : number; senderId? : string } = {}) {
    const sent : ForwardedMetricMessage[] = [];
    const recording = createRecordingMeter();
    const receiver = createMeterReceiver(recording.meter);
    const forwarding = createForwardingMeter(
        // Structured clone, as postMessage does
        { postMessage : (message) => { sent.push(message); receiver.handleMessage(structuredClone(message)); } },
        {
            setIntervalFn : (fn, ms) => setInterval(fn, ms) as unknown as number,
            clearIntervalFn : (id) => clearInterval(id),
            ...options,
        },
    );
    return { sent, recording, forwarding };
}

describe("forwarding meter", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("creates the instruments on the other side with their first records, with their options", () => {
        const { forwarding, recording, sent } = createPair();
        const advice = { explicitBucketBoundaries : [0, 10, 100] };
        forwarding.meter.createHistogram("lag_drift_histogram", { unit : "ms", description : "lag", advice }).record(3);
        forwarding.meter.createCounter("lag_gc_events", { unit : "{gc}" }).add(1);
        forwarding.meter.createCounter("lag_unused", { unit : "{x}" });
        expect(sent).toEqual([]);

        forwarding.flush();

        expect(recording.instruments().map(i => [i.name, i.kind, i.unit, i.advice])).toEqual([
            ["lag_drift_histogram", "histogram", "ms", advice],
            ["lag_gc_events", "counter", "{gc}", undefined],
        ]);
    });

    it("sends records in batches at the flush interval", () => {
        const { forwarding, recording, sent } = createPair({ flushIntervalMs : 1_000 });
        const histogram = forwarding.meter.createHistogram("h", { unit : "ms" });
        const counter = forwarding.meter.createCounter<{ kind : string }>("c", { unit : "1" });

        histogram.record(5);
        histogram.record(7);
        counter.add(1, { kind : "x" });
        expect(recording.values("h")).toEqual([]);

        vi.advanceTimersByTime(1_000);

        expect(recording.values("h")).toEqual([5, 7]);
        expect(recording.records().get("c")).toEqual([{ value : 1, attributes : { kind : "x" } }]);
        expect(sent).toHaveLength(1);
    });

    it("sends at once when the buffer is full", () => {
        const { forwarding, recording } = createPair({ maxBufferedRecords : 3 });
        const histogram = forwarding.meter.createHistogram("h", { unit : "ms" });
        for (let i = 0; i < 3; i++) histogram.record(i);
        expect(recording.values("h")).toEqual([0, 1, 2]);
    });

    it("sends no empty batches", () => {
        const { sent } = createPair();
        vi.advanceTimersByTime(10_000);
        expect(sent).toEqual([]);
    });

    it("dispose() sends the rest and stops the timer", () => {
        const { forwarding, recording } = createPair();
        forwarding.meter.createHistogram("h", { unit : "ms" }).record(9);
        forwarding.dispose();
        expect(recording.values("h")).toEqual([9]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it("the receiver ignores records for unknown instruments", () => {
        const recording = createRecordingMeter();
        const receiver = createMeterReceiver(recording.meter);
        expect(() => receiver.handleMessage({ type : "records", sender : "s", instruments : [], records : [[42, 1, undefined]] })).not.toThrow();
        expect(recording.instruments()).toEqual([]);
    });

    it("sends the kind of each instrument in the batch of its first record, with the ID of the sender", () => {
        const { forwarding, sent } = createPair({ senderId : "page-1" });
        const counter = forwarding.meter.createCounter("lag_gc_events", { unit : "{gc}" });
        counter.add(1);
        forwarding.flush();
        counter.add(2);
        forwarding.flush();

        expect(sent).toEqual([
            {
                type : "records",
                sender : "page-1",
                instruments : [{ id : 1, kind : "counter", name : "lag_gc_events", options : { unit : "{gc}" } }],
                records : [[1, 1, undefined]],
            },
            { type : "records", sender : "page-1", instruments : [], records : [[1, 2, undefined]] },
        ]);
    });

    it("gives each forwarding meter its own random sender ID", () => {
        const first = createPair();
        const second = createPair();
        first.forwarding.meter.createCounter("c", { unit : "1" }).add(1);
        second.forwarding.meter.createCounter("c", { unit : "1" }).add(1);
        first.forwarding.flush();
        second.forwarding.flush();

        const [a, b] = [first.sent[0]!.sender, second.sent[0]!.sender];
        expect(a).toMatch(/^[0-9a-f]{32}$/);
        expect(b).not.toBe(a);
    });

    it("keeps the instruments of two senders apart in one receiver", () => {
        const recording = createRecordingMeter();
        const receiver = createMeterReceiver(recording.meter);
        const target = { postMessage : (message : ForwardedMetricMessage) => receiver.handleMessage(structuredClone(message)) };
        const timers = { setIntervalFn : () => 0, clearIntervalFn : () => {} };
        const page = createForwardingMeter(target, timers);
        const frame = createForwardingMeter(target, timers);

        // Each sender gives the ID 1 to its first instrument
        const drift = frame.meter.createHistogram("lag_drift_histogram", { unit : "ms" });
        const gc = page.meter.createCounter("lag_gc_events", { unit : "{gc}" });
        const frameDelta = page.meter.createHistogram("lag_frame_delta_histogram", { unit : "ms" });
        gc.add(1);
        frameDelta.record(16);
        page.flush();
        drift.record(42);
        frame.flush();
        gc.add(1);
        page.flush();

        expect(recording.values("lag_gc_events")).toEqual([1, 1]);
        expect(recording.values("lag_drift_histogram")).toEqual([42]);
        expect(recording.values("lag_frame_delta_histogram")).toEqual([16]);
    });

    it("gives the records to a receiver that starts to listen after the creation of the instruments", () => {
        const recording = createRecordingMeter();
        const receiver = createMeterReceiver(recording.meter);
        let listening = false;
        // A worker that sets its message listener late: the earlier messages are lost
        const target = { postMessage : (message : ForwardedMetricMessage) => { if (listening) receiver.handleMessage(structuredClone(message)); } };
        const forwarding = createForwardingMeter(target, { setIntervalFn : () => 0, clearIntervalFn : () => {} });
        const histogram = forwarding.meter.createHistogram("lag_drift_histogram", { unit : "ms" });

        listening = true;
        histogram.record(5);
        forwarding.flush();

        expect(recording.values("lag_drift_histogram")).toEqual([5]);
    });

    it("ignores the records after dispose()", () => {
        const { forwarding, sent } = createPair();
        const histogram = forwarding.meter.createHistogram("h", { unit : "ms" });
        histogram.record(1);
        forwarding.dispose();
        histogram.record(2);
        forwarding.meter.createCounter("c", { unit : "1" }).add(1);
        forwarding.flush();
        vi.advanceTimersByTime(10_000);

        expect(sent.flatMap(m => m.records.map(r => r[1]))).toEqual([1]);
    });

    it("flushes at the interval of the options", () => {
        const { forwarding, recording } = createPair({ flushIntervalMs : 250 });
        forwarding.meter.createHistogram("h", { unit : "ms" }).record(5);

        vi.advanceTimersByTime(250);

        expect(recording.values("h")).toEqual([5]);
        forwarding.dispose();
    });

    it("sends each record in one batch only, and no batch when no record came after the last batch", () => {
        const { forwarding, sent } = createPair();
        const histogram = forwarding.meter.createHistogram("h", { unit : "ms" });

        histogram.record(1);
        forwarding.flush();
        forwarding.flush();
        histogram.record(2);
        forwarding.flush();

        expect(sent.map(m => m.records)).toEqual([
            [[1, 1, undefined]],
            [[1, 2, undefined]],
        ]);
    });
});
