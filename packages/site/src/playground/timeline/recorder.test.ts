import { describe, expect, it } from "vitest";
import { SessionRecorder } from "./recorder";

const ORIGIN = 1_700_000_000_000;

function recorder(now = 0, capacity = {}) {
    let clock = now;
    const instance = new SessionRecorder({ origin : ORIGIN, now : () => clock, capacity });
    return { instance, setNow : (value : number) => { clock = value; } };
}

describe("SessionRecorder", () => {
    it("records events at the time of the occurrence, on the session clock", () => {
        const { instance } = recorder(500);
        const attributes = { kind : "hang", duration_ms : 6200 };
        instance.events.emit("lag.stall", attributes, { time : ORIGIN + 1234 });
        attributes.kind = "changed";
        expect(instance.contents().events).toEqual([{ name : "lag.stall", time : 1234, attributes : { kind : "hang", duration_ms : 6200 } }]);
    });

    it("gives an event without a time (or with a time that is not finite) the time of the call", () => {
        const { instance } = recorder(750);
        instance.events.emit("a", {});
        instance.events.emit("b", {}, { time : Number.NaN });
        expect(instance.contents().events.map(event => event.time)).toEqual([750, 750]);
    });

    it("gives each span an identity, and keeps the trace of the parent", () => {
        const { instance } = recorder();
        const view = instance.spans.start("lag.page_view", { startTime : ORIGIN + 100, attributes : { "lag.page_view.id" : "v1" } });
        expect(view.identity?.traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(view.identity?.spanId).toMatch(/^[0-9a-f]{16}$/);
        expect(view.identity?.traceId).not.toMatch(/^0+$/);
        instance.spans.record("lag.main_thread.hang", { startTime : ORIGIN + 2000, endTime : ORIGIN + 8000, parent : view.identity!, attributes : { phase : "ended" } });
        const [page, hang] = instance.contents().spans;
        expect(page).toMatchObject({ name : "lag.page_view", start : 100, end : undefined, parentId : undefined });
        expect(hang).toMatchObject({ name : "lag.main_thread.hang", start : 2000, end : 8000, parentId : view.identity!.spanId });
        expect(hang!.id).not.toBe(page!.id);
    });

    it("changes the attributes and the end of an open span only until it ends", () => {
        const { instance } = recorder();
        const view = instance.spans.start("lag.page_view", { startTime : ORIGIN });
        const before = instance.contents();
        view.setAttributes({ "lag.web_vital.lcp" : 812 });
        view.end(ORIGIN + 9000);
        view.end(ORIGIN + 12_000);
        view.setAttributes({ "lag.web_vital.inp" : 40 });
        expect(before.spans[0]).toMatchObject({ end : undefined, attributes : {} });
        expect(instance.contents().spans[0]).toMatchObject({ end : 9000, attributes : { "lag.web_vital.lcp" : 812 } });
    });

    it("keeps the entries of the probes", () => {
        const { instance } = recorder();
        instance.longAnimationFrame({ startTime : 10, duration : 120, blockingDuration : 70, renderDuration : 4 });
        instance.interaction({ interactionId : 7, name : "click", type : "pointer", startTime : 9, duration : 130, inputDelay : 2, processingDuration : 120, presentationDelay : 8 });
        instance.layoutShift({ startTime : 30, value : 0.05 });
        const contents = instance.contents();
        expect(contents.frames).toHaveLength(1);
        expect(contents.interactions[0]?.interactionId).toBe(7);
        expect(contents.shifts).toEqual([{ startTime : 30, value : 0.05 }]);
    });

    it("keeps only the newest items of each kind", () => {
        const { instance } = recorder(0, { events : 2, shifts : 1 });
        for (const name of ["a", "b", "c"]) instance.events.emit(name, {});
        instance.layoutShift({ startTime : 1, value : 0.1 });
        instance.layoutShift({ startTime : 2, value : 0.2 });
        expect(instance.contents().events.map(event => event.name)).toEqual(["b", "c"]);
        expect(instance.contents().shifts).toEqual([{ startTime : 2, value : 0.2 }]);
    });
});
