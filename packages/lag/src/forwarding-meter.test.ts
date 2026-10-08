import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createForwardingMeter, createMeterReceiver, type ForwardedMetricMessage } from "./forwarding-meter.js";
import { createRecordingMeter } from "./test-utils.js";

function createPair(options : { flushIntervalMs? : number; maxBufferedRecords? : number } = {}) {
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

    it("creates the instruments on the other side at once, with their options", () => {
        const { forwarding, recording } = createPair();
        forwarding.meter.createHistogram("lag_drift_histogram", { unit : "ms", description : "lag" });
        forwarding.meter.createCounter("lag_gc_events", { unit : "{gc}" });

        expect(recording.instruments().map(i => [i.name, i.kind, i.unit])).toEqual([
            ["lag_drift_histogram", "histogram", "ms"],
            ["lag_gc_events", "counter", "{gc}"],
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
        expect(sent.filter(m => m.type === "records")).toHaveLength(1);
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
        expect(() => receiver.handleMessage({ type : "records", records : [[42, 1, undefined]] })).not.toThrow();
    });

    it("sends the kind of each instrument, and a first batch with the records of the meter only", () => {
        const { forwarding, sent } = createPair();
        forwarding.meter.createCounter("lag_gc_events", { unit : "{gc}" }).add(1);
        forwarding.flush();

        expect(sent).toEqual([
            { type : "instrument", id : 1, kind : "counter", name : "lag_gc_events", options : { unit : "{gc}" } },
            { type : "records", records : [[1, 1, undefined]] },
        ]);
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

        expect(sent.filter(m => m.type === "records")).toEqual([
            { type : "records", records : [[1, 1, undefined]] },
            { type : "records", records : [[1, 2, undefined]] },
        ]);
    });
});
