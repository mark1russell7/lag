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

        it("combines the entries of one interaction that have the longest duration", () => {
            const c = collector();
            c.addEvent(event({ interactionId : 5, startTime : 100, duration : 104, name : "pointerup", processingStart : 120, processingEnd : 130 }));
            c.addEvent(event({ interactionId : 5, startTime : 100, duration : 104, name : "click", processingStart : 131, processingEnd : 170, target : { id : "buy" } }));

            expect(byName(c.values())["INP"]!.attribution).toEqual({
                interaction_target : "#buy",
                interaction_type : "pointer",
                input_delay_ms : 20,
                processing_duration_ms : 50,
                presentation_delay_ms : 34,
            });
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
            expect(values["LCP"]).toEqual({ name : "LCP", value : 900, attribution : { target : "#footer" } });
            expect(values["TTFB"]!.value).toBe(0);
        });

        it("leaves out the vitals that have no value", () => {
            expect(collector().values()).toEqual([]);
        });
    });
});
