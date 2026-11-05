import { describe, expect, it, vi } from "vitest";
import { IDLE_GRID_CHANGE_MS, createPageChangeClock, domPageChanges, type MutationObserverConstructor, type PageChangeSource } from "./page-change.js";

/** A source whose changes and animations the test sets. */
function manualSource() {
    let onChange : (() => void) | undefined;
    const stop = vi.fn();
    const state = { animating : false };
    const source : PageChangeSource = {
        observe(callback) {
            onChange = callback;
            return stop;
        },
        animating : () => state.animating,
    };
    return { source, change : () => onChange?.(), stop, state };
}

describe("createPageChangeClock", () => {
    it("gives the time since its start, and then since the last change", () => {
        let now = 1_000;
        const { source, change } = manualSource();
        const clock = createPageChangeClock(source, { now : () => now });
        now = 4_000;
        expect(clock.sinceChangeMs()).toBe(3_000);
        change();
        now = 4_500;
        expect(clock.sinceChangeMs()).toBe(500);
    });

    it("gives 0 while an animation runs, and counts from the end of the animation", () => {
        let now = 0;
        const { source, state } = manualSource();
        const clock = createPageChangeClock(source, { now : () => now });
        now = 40_000;
        state.animating = true;
        expect(clock.sinceChangeMs()).toBe(0);
        state.animating = false;
        now = 41_000;
        expect(clock.sinceChangeMs()).toBe(1_000);
    });

    it("stops its source at dispose", () => {
        const { source, stop } = manualSource();
        createPageChangeClock(source, { now : () => 0 }).dispose();
        expect(stop).toHaveBeenCalledTimes(1);
    });

    it("names 30 s as the time of the idle grid, the earliest start of 4 rows on macOS CI", () => {
        expect(IDLE_GRID_CHANGE_MS).toBe(30_000);
    });
});

describe("domPageChanges", () => {
    /** A MutationObserver that records its calls, and that the test can fire. */
    function fakeObserver() {
        const calls : { target : unknown; options : unknown }[] = [];
        const disconnect = vi.fn();
        let fire : (() => void) | undefined;
        class Observer {
            constructor(callback : () => void) {
                fire = callback;
            }
            observe(target : unknown, options : unknown) {
                calls.push({ target, options });
            }
            disconnect() {
                disconnect();
            }
        }
        return { Observer : Observer as unknown as MutationObserverConstructor, calls, disconnect, fire : () => fire?.() };
    }

    it("observes all of the tree of the document, and stops", () => {
        const observer = fakeObserver();
        const root = {};
        const onChange = vi.fn();
        const stop = domPageChanges(observer.Observer, { documentElement : root }).observe(onChange);
        expect(observer.calls).toEqual([{ target : root, options : { subtree : true, childList : true, attributes : true, characterData : true } }]);
        observer.fire();
        expect(onChange).toHaveBeenCalledTimes(1);
        stop();
        expect(observer.disconnect).toHaveBeenCalledTimes(1);
    });

    it("finds a running animation, and no animation without getAnimations", () => {
        const { Observer } = fakeObserver();
        const animations = [{ playState : "finished" }];
        const source = domPageChanges(Observer, { documentElement : {}, getAnimations : () => animations });
        expect(source.animating()).toBe(false);
        animations.push({ playState : "running" });
        expect(source.animating()).toBe(true);
        expect(domPageChanges(Observer, { documentElement : {} }).animating()).toBe(false);
    });
});
