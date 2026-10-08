import { describe, it, expect, vi } from "vitest";
import { createNoopEventSink, withEventContext } from "./events.js";

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

    it("gives priority to the attributes of the event", () => {
        const sink = { emit : vi.fn() };
        withEventContext(sink, () => ({ id : "context" })).emit("x", { id : "event" });

        expect(sink.emit).toHaveBeenCalledWith("x", { id : "event" });
    });
});

describe("createNoopEventSink", () => {
    it("accepts events and does nothing", () => {
        expect(() => createNoopEventSink().emit("x", { a : 1 })).not.toThrow();
    });
});
