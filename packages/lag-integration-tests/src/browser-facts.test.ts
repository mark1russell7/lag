import { expect } from "vitest";
import { environment } from "./commands.js";

/**
 * The facts of the research about each engine: the supported entry types
 * (research/browser-support) and the order of listeners at `window`
 * (experiment E1). The library does not depend on these facts, but the
 * documents state them. Thus the test fails if an engine changes, and the
 * documents need an update.
 */

/** The entry types that the research infers from BCD for Firefox and for Safari 26.2 and later. */
const NOT_CHROMIUM_TYPES = ["event", "first-input", "largest-contentful-paint", "mark", "measure", "navigation", "paint", "resource"];

/** The entry types of Chromium that the other engines do not have. */
const CHROMIUM_ONLY_TYPES = ["element", "layout-shift", "long-animation-frame", "longtask", "visibility-state"];

const isChromium = (env : string) : boolean => env === "chromium" || env === "chrome";

describe("Facts of the engines", () => {
    it("gives the entry types of the research", () => {
        const env = environment();
        const types = [...PerformanceObserver.supportedEntryTypes].sort();
        console.log(`Entry types (${env}): ${types.join(", ")}`);

        if (isChromium(env)) {
            expect(types).toEqual(expect.arrayContaining([...NOT_CHROMIUM_TYPES, ...CHROMIUM_ONLY_TYPES]));
        } else {
            expect(types).toEqual(NOT_CHROMIUM_TYPES);
        }
        // Chrome 151 and later have soft navigations by default. Chromium 145 of Playwright does not.
        expect(types.includes("soft-navigation")).toBe(env === "chrome");
    });

    it("starts the listeners at window in the order of experiment E1", () => {
        const env = environment();
        for (const event of [new Event("lag-order"), new PageTransitionEvent("pagehide", { persisted : false })]) {
            const order : string[] = [];
            const bubble = () : void => { order.push("bubble"); };
            const capture = () : void => { order.push("capture"); };
            window.addEventListener(event.type, bubble);
            window.addEventListener(event.type, capture, { capture : true });
            try {
                window.dispatchEvent(event);
            } finally {
                window.removeEventListener(event.type, bubble);
                window.removeEventListener(event.type, capture, { capture : true });
            }
            // Chromium starts the listeners at window in the order of registration. The other engines start the capture listener first.
            expect(order, event.type).toEqual(isChromium(env) ? ["bubble", "capture"] : ["capture", "bubble"]);
        }
    });
});
