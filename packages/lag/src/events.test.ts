import { describe, it, expect, vi } from "vitest";
import { MAX_EVENT_TIME_OFFSET_MS, createNoopEventSink, placeEventTime, withEventContext } from "./events.js";

describe("withEventContext", () => {
    it("adds the context attributes to each event, and reads the context for each event", () => {
        const sink = { emit : vi.fn() };
        let view = "view-1";
        const events = withEventContext(sink, () => ({ "lag.page_view.id" : view }));

        events.emit("lag.stall", { kind : "hang" });
        view = "view-2";
        events.emit("lag.stall", { kind : "suspend" });

        expect(sink.emit.mock.calls).toEqual([
            ["lag.stall", { "lag.page_view.id" : "view-1", kind : "hang" }],
            ["lag.stall", { "lag.page_view.id" : "view-2", kind : "suspend" }],
        ]);
    });

    it("gives the options of the event to the sink, and no options when the event has none", () => {
        const sink = { emit : vi.fn() };
        const events = withEventContext(sink, () => ({}));
        events.emit("a", {}, { time : 5 });
        events.emit("b", {});

        expect(sink.emit.mock.calls).toEqual([["a", {}, { time : 5 }], ["b", {}]]);
    });

    it("gives priority to the attributes of the event", () => {
        const sink = { emit : vi.fn() };
        withEventContext(sink, () => ({ id : "context" })).emit("x", { id : "event" });

        expect(sink.emit).toHaveBeenCalledWith("x", { id : "event" });
    });
});

describe("placeEventTime", () => {
    const now = 1_700_000_000_000;

    it("gives the time of the occurrence when it is no more than 30 minutes from the time of the call", () => {
        expect(MAX_EVENT_TIME_OFFSET_MS).toBe(1_800_000);
        expect(placeEventTime(now - 1_800_000, now)).toEqual({ timestamp : now - 1_800_000, attributes : {} });
        expect(placeEventTime(now + 1_800_000, now)).toEqual({ timestamp : now + 1_800_000, attributes : {} });
    });

    it("gives no time, but the attribute lag.event.time, for an occurrence farther from the time of the call", () => {
        expect(placeEventTime(now - 1_800_001, now)).toEqual({ timestamp : undefined, attributes : { "lag.event.time" : now - 1_800_001 } });
        expect(placeEventTime(now + 1_800_001, now)).toEqual({ timestamp : undefined, attributes : { "lag.event.time" : now + 1_800_001 } });
        expect(placeEventTime(now - 11, now, 10)).toEqual({ timestamp : undefined, attributes : { "lag.event.time" : now - 11 } });
    });

    it("gives nothing for an unknown time or a time that is not a finite number", () => {
        for (const time of [undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
            expect(placeEventTime(time, now)).toEqual({ timestamp : undefined, attributes : {} });
        }
    });
});

describe("createNoopEventSink", () => {
    it("accepts events and does nothing", () => {
        expect(() => createNoopEventSink().emit("x", { a : 1 })).not.toThrow();
    });
});
