import { describe, it, expect } from "vitest";
import { SHORT_INTERACTION_ESTIMATE_MS, ViewCollector, type EventEntryLike, type PageView } from "./ViewCollector.js";
import type { NavigationType, VitalValue } from "./types.js";

const describeNode = (node : unknown) => `#${(node as { id : string }).id}`;

function collector(navigationType : NavigationType = "navigate", startTime = 0, readInteractionCount? : () => number) {
    const view : PageView = { id : "view", navigationType, startTime };
    return new ViewCollector(view, describeNode, readInteractionCount);
}

function event(fields : Partial<EventEntryLike> & { interactionId : number; startTime : number; duration : number }) : EventEntryLike {
    return {
        name : "pointerdown",
        processingStart : fields.startTime + 2,
        processingEnd : fields.startTime + 4,
        ...fields,
    };
}

const byName = (values : VitalValue[]) => Object.fromEntries(values.map(v => [v.name, v]));

describe("ViewCollector", () => {
    describe("INP", () => {
        it("is 0 for a first input with the duration 0, as in web-vitals", () => {
            const c = collector("navigate", 0, () => 1);
            c.addEvent(event({ interactionId : 3, startTime : 500, duration : 0 }));
            expect(byName(c.values())["INP"]?.value).toBe(0);
        });

        it("counts the interactions of a view that starts at 0 (the load) from 0, and of a later view from its start", () => {
            let count = 100;
            const load = collector("navigate", 0, () => count);
            const restored = collector("back-forward-cache", 5_000, () => count);
            for (const c of [load, restored]) {
                c.addEvent(event({ interactionId : 7, startTime : 6_000, duration : 600 }));
                c.addEvent(event({ interactionId : 14, startTime : 7_000, duration : 500 }));
                c.addEvent(event({ interactionId : 21, startTime : 8_000, duration : 400 }));
            }
            count = 110;
            // The load: min(2, floor(110 / 50)) = 2. The restored view: floor(10 / 50) = 0.
            expect(byName(load.values())["INP"]!.value).toBe(400);
            expect(byName(restored.values())["INP"]!.value).toBe(600);
        });

        it("is the longest interaction when there are fewer than 50", () => {
            const c = collector();
            c.addEvent(event({ interactionId : 1, startTime : 10, duration : 40 }));
            c.addEvent(event({ interactionId : 2, startTime : 20, duration : 120 }));
            c.addEvent(event({ interactionId : 3, startTime : 30, duration : 64 }));

            expect(byName(c.values())["INP"]!.value).toBe(120);
        });

        it("uses the longest entry of each interaction", () => {
            const c = collector();
            c.addEvent(event({ interactionId : 1, startTime : 10, duration : 40, name : "pointerdown" }));
            c.addEvent(event({ interactionId : 1, startTime : 12, duration : 96, name : "click" }));

            expect(byName(c.values())["INP"]!.value).toBe(96);
        });

        it("counts the first-input entry as a candidate, because the browser always delivers it", () => {
            // 60 interactions, but only one long one and the first input have entries:
            // the candidate at index min(1, floor(60 / 50)) = 1 is the first input, as in web-vitals
            let count = 0;
            const c = collector("navigate", 0, () => count);
            c.addEvent(event({ interactionId : 1, startTime : 10, duration : 24, name : "pointerdown" }));
            c.addEvent(event({ interactionId : 9, startTime : 900, duration : 300 }));
            count = 60;

            expect(byName(c.values())["INP"]!.value).toBe(24);
        });

        it("ignores entries without an interaction ID and entries from before the view", () => {
            const c = collector("back-forward-cache", 1_000);
            c.addEvent(event({ interactionId : 0, startTime : 1_100, duration : 200 }));
            c.addEvent(event({ interactionId : 4, startTime : 900, duration : 300 }));

            expect(byName(c.values())["INP"]).toBeUndefined();
        });

        it("gives the target, the type and the three phases of the INP interaction", () => {
            const c = collector();
            c.addEvent(event({ interactionId : 5, startTime : 100, duration : 200, name : "keydown", processingStart : 130, processingEnd : 210, target : { id : "search" } }));

            expect(byName(c.values())["INP"]!.attribution).toEqual({
                interaction_target : "#search",
                interaction_type : "keyboard",
                input_delay_ms : 30,
                processing_duration_ms : 80,
                presentation_delay_ms : 90,
            });
        });

        it("caps the processing at the next paint, for example after alert()", () => {
            const c = collector();
            c.addEvent(event({ interactionId : 5, startTime : 100, duration : 104, processingStart : 110, processingEnd : 900 }));

            const a = byName(c.values())["INP"]!.attribution;
            expect(a["processing_duration_ms"]).toBe(94);
            expect(a["presentation_delay_ms"]).toBe(0);
            expect(Number(a["input_delay_ms"]) + Number(a["processing_duration_ms"]) + Number(a["presentation_delay_ms"])).toBe(104);
        });

        it("spans the processing over the entries of the interaction in the same frame", () => {
            // A real click: pointerdown is the longest entry, the click handler does the work
            const c = collector();
            c.addEvent(event({ interactionId : 5, startTime : 100, duration : 208, name : "pointerdown", processingStart : 101, processingEnd : 101.3 }));
            c.addEvent(event({ interactionId : 5, startTime : 150, duration : 160, name : "pointerup", processingStart : 151, processingEnd : 151.2 }));
            c.addEvent(event({ interactionId : 5, startTime : 152, duration : 152, name : "click", processingStart : 152, processingEnd : 280, target : { id : "buy" } }));

            expect(byName(c.values())["INP"]!.attribution).toEqual({
                interaction_target : "#buy",
                interaction_type : "pointer",
                input_delay_ms : 1,
                processing_duration_ms : 179,
                presentation_delay_ms : 28,
            });
        });

        it("leaves out the interaction that started a soft navigation, also when its entry comes late", () => {
            const view : PageView = { id : "view", navigationType : "soft-navigation", startTime : 3_000, interactionId : 77 };
            const c = new ViewCollector(view, describeNode);
            c.addEvent(event({ interactionId : 77, startTime : 3_000, duration : 240, name : "click" }));
            expect(byName(c.values())["INP"]).toBeUndefined();

            c.addEvent(event({ interactionId : 80, startTime : 4_000, duration : 96 }));
            expect(byName(c.values())["INP"]!.value).toBe(96);
        });

        it("counts the processing of other events in the frame, as web-vitals does", () => {
            const c = collector();
            // A pointerover handler (no interaction) runs in the frame of the click, after the click handler
            c.addEvent(event({ interactionId : 5, startTime : 100, duration : 200, name : "click", processingStart : 110, processingEnd : 150 }));
            c.addEvent(event({ interactionId : 0, startTime : 120, duration : 182, name : "pointerover", processingStart : 150, processingEnd : 240 }));
            // An entry of another frame does not count
            c.addEvent(event({ interactionId : 0, startTime : 400, duration : 40, name : "pointermove", processingStart : 401, processingEnd : 430 }));

            const a = byName(c.values())["INP"]!.attribution;
            expect(a).toMatchObject({ input_delay_ms : 10, processing_duration_ms : 130, presentation_delay_ms : 60 });
        });

        it("starts the processing at the interaction at the earliest", () => {
            const c = collector();
            // A long handler of an earlier event in the same frame started before the key press
            c.addEvent(event({ interactionId : 0, startTime : 40, duration : 168, name : "pointerover", processingStart : 50, processingEnd : 150 }));
            c.addEvent(event({ interactionId : 5, startTime : 100, duration : 104, name : "keydown", processingStart : 150, processingEnd : 180 }));

            const a = byName(c.values())["INP"]!.attribution;
            expect(a).toMatchObject({ input_delay_ms : 0, processing_duration_ms : 80, presentation_delay_ms : 24 });
        });

        it("leaves out the entries of the interaction that end in a different frame", () => {
            const c = collector();
            c.addEvent(event({ interactionId : 5, startTime : 100, duration : 104, name : "keydown", processingStart : 110, processingEnd : 150 }));
            // keyup ends 300 ms later, in another frame
            c.addEvent(event({ interactionId : 5, startTime : 380, duration : 24, name : "keyup", processingStart : 381, processingEnd : 400 }));

            const a = byName(c.values())["INP"]!.attribution;
            expect(a["processing_duration_ms"]).toBe(40);
            expect(a["interaction_type"]).toBe("keyboard");
        });

        it("keeps the entry details only for the interactions that can be INP", () => {
            const c = collector();
            for (let id = 1; id <= 200; id++) c.addEvent(event({ interactionId : id, startTime : id, duration : 16 + id, target : { id : `b${id}` } }));

            const kept = (c as unknown as { interactions : Map<number, unknown> }).interactions;
            expect(kept.size).toBeLessThanOrEqual(10);
            // 200 interactions: INP ignores the 4 longest, thus it is the fifth longest
            expect(byName(c.values())["INP"]!.attribution["interaction_target"]).toBe("#b196");
        });

        it("gives 8 ms after a restore when there were interactions but no entries", () => {
            let count = 3;
            const restored = collector("back-forward-cache", 1_000, () => count);
            const load = collector("navigate", 0, () => count);
            count = 5;

            expect(byName(restored.values())["INP"]).toEqual({ name : "INP", value : SHORT_INTERACTION_ESTIMATE_MS, attribution : {} });
            expect(byName(load.values())["INP"]).toBeUndefined();
        });
    });

    describe("CLS", () => {
        it("reports a load only after FCP, and then includes the shifts from before FCP", () => {
            const c = collector();
            c.addLayoutShift({ startTime : 100, value : 0.05, hadRecentInput : false });
            expect(byName(c.values())["CLS"]).toBeUndefined();

            c.setFcp(150);
            c.addLayoutShift({ startTime : 200, value : 0.02, hadRecentInput : false });
            expect(byName(c.values())["CLS"]!.value).toBeCloseTo(0.07);
        });

        it("reports a restore and a soft navigation from the start, at 0", () => {
            expect(byName(collector("back-forward-cache", 10).values())["CLS"]!.value).toBe(0);
            expect(byName(collector("soft-navigation", 10).values())["CLS"]!.value).toBe(0);
        });

        it("ignores shifts after recent input and shifts from before the view", () => {
            const c = collector("soft-navigation", 1_000);
            c.addLayoutShift({ startTime : 1_100, value : 0.3, hadRecentInput : true });
            c.addLayoutShift({ startTime : 900, value : 0.3, hadRecentInput : false });

            expect(byName(c.values())["CLS"]!.value).toBe(0);
        });

        it("names the largest shift of the worst session window", () => {
            const c = collector("soft-navigation", 0);
            c.addLayoutShift({ startTime : 10, value : 0.01, hadRecentInput : false, sources : [{ node : { id : "small" } }] });
            c.addLayoutShift({ startTime : 20, value : 0.2, hadRecentInput : false, sources : [{ node : null }, { node : { id : "banner" } }] });

            expect(byName(c.values())["CLS"]!.attribution).toEqual({ largest_shift_target : "#banner" });
        });
    });

    describe("the time of each value", () => {
        it("is the time of the occurrence that gave the value, also in a view that starts later", () => {
            const c = collector("back-forward-cache", 5_000, () => 2);
            c.setTtfb(0);
            c.setFcp(40);
            c.setLcp(120);
            // The INP interaction: its first entry starts at 6000
            c.addEvent(event({ interactionId : 7, startTime : 6_000, duration : 300 }));
            c.addEvent(event({ interactionId : 7, startTime : 6_004, duration : 280, name : "click" }));
            c.addEvent(event({ interactionId : 9, startTime : 7_000, duration : 100 }));
            // The largest shift of the worst window is at 8200
            c.addLayoutShift({ startTime : 8_000, value : 0.05, hadRecentInput : false });
            c.addLayoutShift({ startTime : 8_200, value : 0.1, hadRecentInput : false });
            c.addLayoutShift({ startTime : 20_000, value : 0.02, hadRecentInput : false });

            const times = Object.fromEntries(c.values().map(v => [v.name, v.time]));
            expect(times).toEqual({ TTFB : 5_000, FCP : 5_040, LCP : 5_120, INP : 6_000, CLS : 8_200 });
        });

        it("is undefined for an INP estimate and for a CLS without shifts", () => {
            // A restored view counts the interactions from its start: one interaction without an entry
            let count = 3;
            const c = collector("back-forward-cache", 5_000, () => count);
            count = 4;
            const values = byName(c.values());
            expect(values["INP"]).toEqual({ name : "INP", value : SHORT_INTERACTION_ESTIMATE_MS, attribution : {} });
            expect(values["CLS"]).toEqual({ name : "CLS", value : 0, attribution : {} });
        });
    });

    describe("paint and network metrics", () => {
        it("keeps the first FCP, the last LCP, and never a value below 0", () => {
            const c = collector();
            c.setFcp(-5);
            c.setFcp(300);
            c.setLcp(400, { target : "#hero" });
            c.setLcp(900, { target : "#footer" });
            c.setTtfb(-1);

            const values = byName(c.values());
            expect(values["FCP"]!.value).toBe(0);
            expect(values["LCP"]).toEqual({ name : "LCP", value : 900, attribution : { target : "#footer" }, time : 900 });
            expect(values["TTFB"]!.value).toBe(0);
        });

        it("leaves out the vitals that have no value", () => {
            expect(collector().values()).toEqual([]);
        });
    });

    describe("rules of the entries", () => {
        it("counts an event and a layout shift that start at the start of the view", () => {
            const c = collector("back-forward-cache", 1_000);
            c.addEvent(event({ interactionId : 4, startTime : 1_000, duration : 120 }));
            c.addLayoutShift({ startTime : 1_000, value : 0.2, hadRecentInput : false });

            expect(byName(c.values())["INP"]!.value).toBe(120);
            expect(byName(c.values())["CLS"]!.value).toBe(0.2);
        });

        it("gives 8 ms after a soft navigation when there were interactions but no entries", () => {
            let count = 3;
            const c = collector("soft-navigation", 1_000, () => count);
            count = 5;

            expect(byName(c.values())["INP"]).toEqual({ name : "INP", value : SHORT_INTERACTION_ESTIMATE_MS, attribution : {} });
        });

        it("keeps no more than 16 entries of one interaction for the attribution", () => {
            const c = collector();
            for (let i = 0; i < 16; i++) c.addEvent(event({ interactionId : 5, startTime : 100, duration : 40, name : "pointerdown" }));
            // The 17th entry is the longest, but the collector does not keep it
            c.addEvent(event({ interactionId : 5, startTime : 100, duration : 200, name : "keydown" }));

            const inp = byName(c.values())["INP"]!;
            expect(inp.value).toBe(200);
            expect(inp.attribution["interaction_type"]).toBe("pointer");
        });

        it("uses the longest entry of an interaction for the attribution, and the first one of entries with the same duration, as web-vitals does", () => {
            const longestLast = collector();
            longestLast.addEvent(event({ interactionId : 5, startTime : 100, duration : 40, name : "pointerdown", processingStart : 102, processingEnd : 104 }));
            longestLast.addEvent(event({ interactionId : 5, startTime : 104, duration : 96, name : "click", processingStart : 110, processingEnd : 150 }));
            const sameDuration = collector();
            sameDuration.addEvent(event({ interactionId : 5, startTime : 100, duration : 96, name : "pointerdown", processingStart : 102, processingEnd : 104 }));
            sameDuration.addEvent(event({ interactionId : 5, startTime : 104, duration : 96, name : "click", processingStart : 110, processingEnd : 150 }));

            // The interaction starts at the start of the entry that the attribution uses
            expect(byName(longestLast.values())["INP"]!.attribution["input_delay_ms"]).toBe(6);
            expect(byName(sameDuration.values())["INP"]!.attribution["input_delay_ms"]).toBe(2);
        });

        it("puts the entries whose render times are 8 ms apart into one frame", () => {
            const c = collector();
            // The click renders at 200 ms, and the pointerover renders at 208 ms
            c.addEvent(event({ interactionId : 5, startTime : 100, duration : 100, name : "click", processingStart : 110, processingEnd : 150 }));
            c.addEvent(event({ interactionId : 0, startTime : 120, duration : 88, name : "pointerover", processingStart : 150, processingEnd : 190 }));

            expect(byName(c.values())["INP"]!.attribution["processing_duration_ms"]).toBe(80);
        });

        it("gives no interaction target when the target of the event is null or when no entry has a target", () => {
            const removed = collector();
            removed.addEvent(event({ interactionId : 5, startTime : 100, duration : 200, target : null }));
            const without = collector();
            without.addEvent(event({ interactionId : 5, startTime : 100, duration : 200 }));

            expect(byName(removed.values())["INP"]!.attribution["interaction_target"]).toBe("");
            expect(byName(without.values())["INP"]!.attribution["interaction_target"]).toBe("");
        });

        it("names the first source with a node, also after a source without a node", () => {
            const c = collector("soft-navigation", 0);
            c.addLayoutShift({ startTime : 20, value : 0.2, hadRecentInput : false, sources : [{}, { node : { id : "banner" } }] });

            expect(byName(c.values())["CLS"]!.attribution).toEqual({ largest_shift_target : "#banner" });
        });

        it("gives no CLS target when the largest shift has no source", () => {
            const c = collector("soft-navigation", 0);
            c.addLayoutShift({ startTime : 20, value : 0.2, hadRecentInput : false });

            expect(byName(c.values())["CLS"]!.attribution).toEqual({});
        });

        it("keeps an LCP that paints at the time at which the LCP became final, and ignores a later paint", () => {
            const c = collector();
            c.finalizeLcpAt(1_000);
            c.setLcp(1_000, { target : "#title" }, 1_000);
            c.setLcp(1_200, { target : "#late" }, 1_200);

            expect(byName(c.values())["LCP"]).toEqual({ name : "LCP", value : 1_000, attribution : { target : "#title" }, time : 1_000 });
        });
    });
});
