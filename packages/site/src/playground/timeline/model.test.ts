import { describe, expect, it } from "vitest";
import type { RecordedInteractionEvent } from "../../adapters/lag-core";
import {
    buildTimelineModel,
    EARLIEST_START,
    groupInteractions,
    lifecycleSegments,
    placeLateWindows,
    pressureSegments,
    rateDuration,
    type TimelineSource,
} from "./model";
import type { RecordedEvent, RecorderContents } from "./recorder";

const NAMES = {
    pageView : "view",
    hang : "hang",
    stall : "stall",
    longAnimationFrame : "loaf",
    hidden : "hidden",
    frozen : "frozen",
    lifecycleTransition : "transition",
    pressureChange : "pressure",
} as const;

const THRESHOLDS = { good : 200, poor : 500 };
const EMPTY_RECORD : RecorderContents = { events : [], spans : [], frames : [], interactions : [], shifts : [] };

/** A source whose session started at 10 000 ms and whose present time is 40 000 ms. */
function source(changes : Partial<TimelineSource> = {}) : TimelineSource {
    return {
        startedAt : 10_000,
        now : 40_000,
        running : true,
        config : { names : NAMES, inpThresholds : THRESHOLDS },
        drift : [],
        macrotask : [],
        recorded : EMPTY_RECORD,
        vitals : [],
        loads : [],
        lifecycleState : "active",
        support : { longAnimationFrame : true, eventTiming : true, layoutShift : true },
        ...changes,
    };
}

const seconds = (ms : number) : number => ms / 1000;
const event = (name : string, time : number, attributes : RecordedEvent["attributes"]) : RecordedEvent => ({ name, time, attributes });

function entry(interactionId : number, name : string, startTime : number, duration : number) : RecordedInteractionEvent {
    return { interactionId, name, type : name.startsWith("key") ? "keyboard" : "pointer", startTime, duration, inputDelay : 3, processingDuration : duration - 10, presentationDelay : 7 };
}

describe("buildTimelineModel", () => {
    it("gives all times in seconds since the start of the session", () => {
        const model = buildTimelineModel(source({
            drift : [{ t : 10_100, value : 2 }, { t : 10_200, value : 300 }],
            macrotask : [{ t : 15_000, value : 4 }],
            recorded : {
                ...EMPTY_RECORD,
                frames : [{ startTime : 12_000, duration : 250, blockingDuration : 200, renderDuration : 8, script : { invoker : "BUTTON.onclick", invokerType : "event-listener", duration : 240 } }],
                shifts : [{ startTime : 13_000, value : 0.02 }],
            },
            vitals : [{ name : "LCP", value : 900, time : 900, rating : "good" }, { name : "INP", value : 40, time : undefined, rating : "good" }],
        }));
        expect(model.now).toBe(30);
        expect(model.drift).toEqual([{ t : 0.1, value : 2 }, { t : 0.2, value : 300 }]);
        expect(model.macrotask).toEqual([{ t : 5, value : 4 }]);
        expect(model.frames).toEqual([{ start : 2, end : 2.25, durationMs : 250, blockingMs : 200, renderMs : 8, script : { invoker : "BUTTON.onclick", invokerType : "event-listener", durationMs : 240 } }]);
        expect(model.shifts).toEqual([{ t : 3, value : 0.02 }]);
        // A vital without a time has no place on the timeline. The LCP of the load is before the session.
        expect(model.vitals).toEqual([{ name : "LCP", t : seconds(900 - 10_000), value : 900, rating : "good" }]);
        expect(model.start).toBeCloseTo(-9.1);
    });

    it("sorts the spans by name, and an open span ends at the present time", () => {
        const model = buildTimelineModel(source({
            recorded : {
                ...EMPTY_RECORD,
                spans : [
                    { id : "1", parentId : undefined, name : "view", start : 0, end : undefined, attributes : { navigation_type : "navigate" } },
                    { id : "3", parentId : "1", name : "stall", start : 22_000, end : 28_200, attributes : { kind : "hang" } },
                    { id : "2", parentId : "1", name : "hang", start : 22_000, end : 28_000, attributes : { phase : "ended" } },
                    { id : "4", parentId : "1", name : "loaf", start : 22_000, end : 28_000, attributes : {} },
                ],
            },
        }));
        expect(model.pageViews).toEqual([{ id : "1", name : "view", start : -10, end : 30, open : true, attributes : { navigation_type : "navigate" } }]);
        expect(model.hangs.map(item => [item.start, item.end, item.open])).toEqual([[12, 18, false]]);
        expect(model.stalls.map(item => item.end)).toEqual([18.2]);
        expect(model.start).toBe(-10);
    });

    it("shows a load that is active until the present time", () => {
        const model = buildTimelineModel(source({
            loads : [
                { label : "Block for 800 ms", start : 11_000, end : 11_800, aborted : false },
                { label : "Heavy profile", start : 35_000, end : undefined, aborted : false },
            ],
        }));
        expect(model.loads).toEqual([
            { start : 1, end : 1.8, label : "Block for 800 ms", aborted : false, active : false },
            { start : 25, end : 30, label : "Heavy profile", aborted : false, active : true },
        ]);
    });

    it("shows nothing that is more than 10 minutes before the session", () => {
        const model = buildTimelineModel(source({
            recorded : {
                ...EMPTY_RECORD,
                frames : [{ startTime : 10_000 - 700_000, duration : 100, blockingDuration : 50, renderDuration : 0 }],
                spans : [{ id : "1", parentId : undefined, name : "hang", start : -2_000_000, end : -1_990_000, attributes : {} }],
            },
        }));
        expect(model.frames).toEqual([]);
        expect(model.hangs).toEqual([]);
        expect(model.start).toBe(0);
        expect(EARLIEST_START).toBe(-600);
    });

    it("uses the time of the stop as the present time", () => {
        const model = buildTimelineModel(source({ running : false, now : 25_000 }));
        expect(model).toMatchObject({ now : 15, running : false });
    });
});

describe("placeLateWindows", () => {
    it("moves a long window that the conditions recorded late to the gap that it fills", () => {
        // Windows each 100 ms to 10 s. A block of 6 s: the next windows end at 16.2 s, 16.3 s and so on.
        // The conditions record the window of 6.1 s at 18.2 s (2 s late).
        const before = Array.from({ length : 5 }, (_, index) => ({ t : 9.6 + index * 0.1, value : 1 }));
        const after = Array.from({ length : 21 }, (_, index) => ({ t : 16.2 + index * 0.1, value : 1 }));
        const late = { t : 18.25, value : 6_100 };
        const placed = placeLateWindows([...before, ...after.filter(point => point.t < late.t), late, ...after.filter(point => point.t > late.t)]);
        const moved = placed.find(point => point.value === 6_100)!;
        // The next window starts at 16.2 s − 0.1 s − 1 ms. But a window of 6.1 s that starts at 10 s ends at 16.1 s or later.
        expect(moved.t).toBeCloseTo(16.1, 6);
        expect(placed.map(point => point.t)).toEqual([...placed.map(point => point.t)].sort((a, b) => a - b));
        expect(placed).toHaveLength(before.length + after.length + 1);
    });

    it("keeps a long window that follows its gap", () => {
        const points = [{ t : 1, value : 1 }, { t : 2.6, value : 1_500 }, { t : 2.7, value : 1 }];
        expect(placeLateWindows(points)).toEqual(points);
    });

    it("keeps a long window without a gap of its length, and gives each gap to one window only", () => {
        const points = [{ t : 1, value : 1 }, { t : 1.1, value : 1 }, { t : 3, value : 1 }, { t : 3.1, value : 1_500 }, { t : 3.2, value : 1_500 }];
        const placed = placeLateWindows(points);
        // The gap from 1.1 s to 3 s takes the first long window. The second long window stays.
        expect(placed.filter(point => point.value === 1_500).map(point => point.t)).toEqual([2.899, 3.2].map(value => expect.closeTo(value, 6)));
    });
});

describe("lifecycleSegments", () => {
    const toSeconds = (ms : number) : number => ms / 1000;

    it("starts with the state before the first transition, and merges a transition to the same state", () => {
        const segments = lifecycleSegments([
            event("transition", 5_000, { from : "active", to : "passive", trigger : "blur" }),
            event("transition", 8_000, { from : "passive", to : "hidden", trigger : "visibilitychange" }),
            event("transition", 8_500, { from : "hidden", to : "hidden", trigger : "pageshow" }),
            event("transition", 12_000, { from : "hidden", to : "active", trigger : "visibilitychange" }),
        ], toSeconds, 20, "active");
        expect(segments).toEqual([
            { start : 0, end : 5, state : "active", trigger : undefined, open : false },
            { start : 5, end : 8, state : "passive", trigger : "blur", open : false },
            { start : 8, end : 12, state : "hidden", trigger : "visibilitychange", open : false },
            { start : 12, end : 20, state : "active", trigger : "visibilitychange", open : true },
        ]);
    });

    it("uses the current state without transitions, and gives nothing without a state", () => {
        expect(lifecycleSegments([], toSeconds, 4, "passive")).toEqual([{ start : 0, end : 4, state : "passive", trigger : undefined, open : true }]);
        expect(lifecycleSegments([], toSeconds, 4, undefined)).toEqual([]);
    });
});

describe("pressureSegments", () => {
    it("makes the periods of each source from its changes", () => {
        const segments = pressureSegments([
            event("pressure", 1_000, { source : "cpu", state : "nominal" }),
            event("pressure", 2_000, { source : "thermals", state : "fair" }),
            event("pressure", 4_000, { source : "cpu", state : "serious", previous_state : "nominal" }),
        ], ms => ms / 1000, 10);
        expect(segments.map(segment => [segment.source, segment.state, segment.start, segment.end, segment.open])).toEqual([
            ["cpu", "nominal", 1, 4, false],
            ["thermals", "fair", 2, 10, true],
            ["cpu", "serious", 4, 10, true],
        ]);
    });
});

describe("groupInteractions", () => {
    it("joins the entries of one interaction, as INP does", () => {
        const items = groupInteractions([
            entry(2, "pointerdown", 1_000, 40),
            entry(2, "click", 1_010, 816),
            entry(2, "pointerup", 1_005, 48),
            entry(5, "keydown", 3_000, 96),
        ], ms => ms / 1000, THRESHOLDS);
        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({ id : 2, start : 1, durationMs : 816, type : "pointer", names : ["pointerdown", "click", "pointerup"], rating : "poor", inputDelayMs : 3, processingMs : 806, presentationMs : 7 });
        expect(items[0]!.end).toBeCloseTo(1.826);
        expect(items[1]).toMatchObject({ id : 5, type : "keyboard", rating : "good" });
    });
});

describe("rateDuration", () => {
    it("uses the INP thresholds: at or below good is good, above poor is poor", () => {
        expect([200, 201, 500, 501].map(value => rateDuration(value, THRESHOLDS))).toEqual(["good", "needs-improvement", "needs-improvement", "poor"]);
    });
});
