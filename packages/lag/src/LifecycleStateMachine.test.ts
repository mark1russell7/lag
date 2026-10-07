import { vi, expect } from "vitest";
import {
    LifecycleStateMachine,
    summarizeTransitions,
    type LifecycleDocument,
    type LifecycleWindow,
} from "./LifecycleStateMachine.js";

type Listener = (e? : { persisted? : boolean }) => void;

function createMocks(initialVisibility : "visible" | "hidden" = "visible", focused = true) {
    const docListeners = new Map<string, Listener[]>();
    const winListeners = new Map<string, Listener[]>();
    const add = (map : Map<string, Listener[]>, event : string, cb : Listener) => {
        if (!map.has(event)) map.set(event, []);
        map.get(event)!.push(cb);
    };
    const remove = (map : Map<string, Listener[]>, event : string, cb : Listener) => {
        const arr = map.get(event) ?? [];
        const idx = arr.indexOf(cb);
        if (idx >= 0) arr.splice(idx, 1);
    };
    let visibilityState = initialVisibility;
    let hasFocusValue = focused;

    const document : LifecycleDocument = {
        get visibilityState() { return visibilityState; },
        set visibilityState(v : string) { visibilityState = v as "visible" | "hidden"; },
        hasFocus : () => hasFocusValue,
        addEventListener : (event, cb) => add(docListeners, event, cb),
        removeEventListener : (event, cb) => remove(docListeners, event, cb),
    };

    const window : LifecycleWindow = {
        addEventListener : (event, cb) => add(winListeners, event, cb),
        removeEventListener : (event, cb) => remove(winListeners, event, cb),
    };

    const listenerCount = () =>
        [...docListeners.values(), ...winListeners.values()].reduce((n, arr) => n + arr.length, 0);
    const hasListener = (event : string) =>
        (docListeners.get(event)?.length ?? 0) + (winListeners.get(event)?.length ?? 0) > 0;

    let now = 0;
    const clock = { now : () => now };

    const fireDoc = (event : string, data? : { persisted? : boolean }) =>
        docListeners.get(event)?.forEach(cb => cb(data));
    const fireWin = (event : string, data? : { persisted? : boolean }) =>
        winListeners.get(event)?.forEach(cb => cb(data));

    const setVisibility = (v : "visible" | "hidden") => {
        visibilityState = v;
        fireDoc("visibilitychange");
    };

    const setFocus = (f : boolean) => {
        hasFocusValue = f;
        fireWin(f ? "focus" : "blur");
    };

    const advanceClock = (ms : number) => { now += ms; };

    /** Flip visibilityState without dispatching the (asynchronous) visibilitychange event. */
    const setVisibilitySilently = (v : "visible" | "hidden") => { visibilityState = v; };

    return {
        document, window, clock, fireDoc, fireWin, setVisibility, setVisibilitySilently, setFocus, advanceClock,
        listenerCount, hasListener,
    };
}

describe("LifecycleStateMachine", () => {
    it("starts in active state when visible and focused", () => {
        const m = createMocks("visible", true);
        const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
        expect(sm.getState()).toBe("active");
    });

    it("starts in passive state when visible but not focused", () => {
        const m = createMocks("visible", false);
        const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
        expect(sm.getState()).toBe("passive");
    });

    it("starts in hidden state when document is hidden", () => {
        const m = createMocks("hidden", false);
        const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
        expect(sm.getState()).toBe("hidden");
    });

    it("transitions active → passive on blur", () => {
        const m = createMocks();
        const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
        m.setFocus(false);
        expect(sm.getState()).toBe("passive");
    });

    it("transitions passive → active on focus", () => {
        const m = createMocks("visible", false);
        const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
        m.setFocus(true);
        expect(sm.getState()).toBe("active");
    });

    it("transitions active → hidden → frozen → hidden → active", () => {
        const m = createMocks();
        const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

        m.setVisibility("hidden");
        expect(sm.getState()).toBe("hidden");

        m.fireDoc("freeze");
        expect(sm.getState()).toBe("frozen");

        m.fireDoc("resume");
        expect(sm.getState()).toBe("hidden");

        m.setVisibility("visible");
        expect(sm.getState()).toBe("active");
    });

    it("transitions to terminated on pagehide(persisted=false)", () => {
        const m = createMocks();
        const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
        m.setVisibility("hidden");
        m.fireWin("pagehide", { persisted : false });
        expect(sm.getState()).toBe("terminated");
    });

    it("transitions to frozen on pagehide(persisted=true) for BFCache", () => {
        const m = createMocks();
        const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
        m.setVisibility("hidden");
        m.fireWin("pagehide", { persisted : true });
        expect(sm.getState()).toBe("frozen");
    });

    it("restores from BFCache on pageshow(persisted=true)", () => {
        const m = createMocks();
        const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

        m.setVisibility("hidden");
        m.fireWin("pagehide", { persisted : true });
        expect(sm.getState()).toBe("frozen");

        // Browser sets visibilityState back to "visible" when restoring from BFCache
        (m.document as { visibilityState : string }).visibilityState = "visible";
        m.fireWin("pageshow", { persisted : true });
        expect(sm.getState()).toBe("active");
    });

    describe("mark/resolve API", () => {
        it("returns transitions that occurred between mark and resolve", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

            const mark = sm.mark();
            m.setFocus(false);  // active → passive
            m.setVisibility("hidden");  // passive → hidden

            const transitions = sm.resolve(mark);
            expect(transitions).toHaveLength(2);
            expect(transitions[0]!.to).toBe("passive");
            expect(transitions[1]!.to).toBe("hidden");
        });

        it("returns empty array if no transitions occurred", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

            const mark = sm.mark();
            const transitions = sm.resolve(mark);
            expect(transitions).toEqual([]);
        });

        it("returns empty for unknown/already-resolved marks", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

            const mark = sm.mark();
            sm.resolve(mark);
            expect(sm.resolve(mark)).toEqual([]);
        });

        it("supports multiple concurrent marks", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

            const markA = sm.mark();
            m.setFocus(false);  // active → passive
            const markB = sm.mark();
            m.setVisibility("hidden");  // passive → hidden

            const a = sm.resolve(markA);
            const b = sm.resolve(markB);

            expect(a).toHaveLength(2); // both transitions
            expect(b).toHaveLength(1); // only the second
            expect(b[0]!.to).toBe("hidden");
        });

        it("compacts buffer when all marks are resolved", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

            const mark = sm.mark();
            m.setFocus(false);
            m.setVisibility("hidden");
            expect(sm.getBufferedCount()).toBe(2);

            sm.resolve(mark);
            expect(sm.getBufferedCount()).toBe(0); // fully compacted
        });

        it("compacts only up to the earliest unresolved mark", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

            const markA = sm.mark();
            m.setFocus(false);
            const markB = sm.mark();
            m.setVisibility("hidden");

            // Resolve B first — A is still holding the earlier portion
            sm.resolve(markB);
            // Buffer must still contain transitions for A
            const aTransitions = sm.resolve(markA);
            expect(aTransitions).toHaveLength(2);
            expect(aTransitions[0]!.to).toBe("passive");
            expect(aTransitions[1]!.to).toBe("hidden");
        });

        it("cancel() drops a mark without retrieving transitions", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

            const mark = sm.mark();
            m.setFocus(false);
            sm.cancel(mark);
            expect(sm.getMarkCount()).toBe(0);
            expect(sm.getBufferedCount()).toBe(0);
        });

        it("transitions accumulate timestamps from the clock", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

            const mark = sm.mark();
            m.advanceClock(100);
            m.setFocus(false);
            m.advanceClock(50);
            m.setVisibility("hidden");

            const transitions = sm.resolve(mark);
            expect(transitions[0]!.timestamp).toBe(100);
            expect(transitions[1]!.timestamp).toBe(150);
        });
    });

    describe("summarizeTransitions", () => {
        it("flags wasHidden when a hidden transition occurred", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const mark = sm.mark();
            m.setVisibility("hidden");
            const summary = summarizeTransitions(sm.resolve(mark));
            expect(summary.wasHidden).toBe(true);
            expect(summary.wasFrozen).toBe(false);
        });

        it("flags wasFrozen when a freeze occurred", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const mark = sm.mark();
            m.setVisibility("hidden");
            m.fireDoc("freeze");
            const summary = summarizeTransitions(sm.resolve(mark));
            expect(summary.wasFrozen).toBe(true);
        });

        it("flags wasRestoredFromBFCache when pageshow restores from frozen", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

            // Drive the page into the frozen state first
            m.setVisibility("hidden");
            m.fireWin("pagehide", { persisted : true });
            expect(sm.getState()).toBe("frozen");

            // Mark, then restore from BFCache
            const mark = sm.mark();
            m.fireWin("pageshow", { persisted : true });

            const summary = summarizeTransitions(sm.resolve(mark));
            expect(summary.wasRestoredFromBFCache).toBe(true);
        });

        it("counts transitions", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const mark = sm.mark();
            m.setFocus(false);
            m.setVisibility("hidden");
            const summary = summarizeTransitions(sm.resolve(mark));
            expect(summary.transitionCount).toBe(2);
        });
    });

    it("does not buffer transitions while no mark is outstanding", () => {
        const m = createMocks();
        const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

        for (let i = 0; i < 100; i++) {
            m.setFocus(false);
            m.setFocus(true);
        }

        expect(sm.getBufferedCount()).toBe(0);
        expect(sm.getTotalTransitions()).toBe(200);
    });

    it("sees a hidden page before the visibilitychange event arrives", () => {
        const m = createMocks();
        const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

        m.setVisibilitySilently("hidden");

        expect(sm.getState()).toBe("hidden");
    });

    it("does not listen for beforeunload (it blocks the BFCache and can be cancelled)", () => {
        const m = createMocks();
        new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

        expect(m.hasListener("beforeunload")).toBe(false);
    });

    it("stays terminated when visibilitychange follows pagehide", () => {
        const m = createMocks();
        const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

        m.fireWin("pagehide", { persisted : false });
        m.setVisibility("hidden");

        expect(sm.getState()).toBe("terminated");
    });

    it("dispose() removes every DOM listener it added", () => {
        const m = createMocks();
        const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
        expect(m.listenerCount()).toBeGreaterThan(0);

        sm.dispose();

        expect(m.listenerCount()).toBe(0);
    });

    describe("subscribe", () => {
        it("notifies on each transition until unsubscribed", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const listener = vi.fn();

            const unsubscribe = sm.subscribe(listener);
            m.setVisibility("hidden");
            unsubscribe();
            m.setVisibility("visible");

            expect(listener).toHaveBeenCalledTimes(1);
            expect(listener).toHaveBeenCalledWith(expect.objectContaining({ from : "active", to : "hidden" }));
        });

        it("isolates a throwing subscriber", () => {
            const m = createMocks();
            const logger = { log : vi.fn() };
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, logger);
            const second = vi.fn();

            sm.subscribe(() => { throw new Error("boom"); });
            sm.subscribe(second);
            m.setVisibility("hidden");

            expect(second).toHaveBeenCalled();
            expect(logger.log).toHaveBeenCalledWith("error", "Error in lifecycle subscriber.", expect.any(Object));
        });
    });

    describe("createHiddenGate", () => {
        it("reports a hidden period once, then resets", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const gate = sm.createHiddenGate();

            expect(gate.wasHiddenSinceLastCheck()).toBe(false);
            m.setVisibility("hidden");
            m.setVisibility("visible");
            expect(gate.wasHiddenSinceLastCheck()).toBe(true);
            expect(gate.wasHiddenSinceLastCheck()).toBe(false);
        });

        it("reports true while the page is still hidden", () => {
            const m = createMocks("hidden", false);
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const gate = sm.createHiddenGate();

            expect(gate.wasHiddenSinceLastCheck()).toBe(true);
            expect(gate.wasHiddenSinceLastCheck()).toBe(true);
        });

        it("gives each consumer its own view of the same hidden period", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const fast = sm.createHiddenGate();
            const slow = sm.createHiddenGate();

            m.setVisibility("hidden");
            m.setVisibility("visible");

            // The fast consumer checking first must not hide the period from the slow one
            expect(fast.wasHiddenSinceLastCheck()).toBe(true);
            expect(slow.wasHiddenSinceLastCheck()).toBe(true);
        });

        it("counts a BFCache round trip as hidden", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const gate = sm.createHiddenGate();

            m.fireWin("pagehide", { persisted : true });
            m.fireWin("pageshow", { persisted : true });

            expect(gate.wasHiddenSinceLastCheck()).toBe(true);
        });

        it("flags a window that started hidden, even if the page is visible by the check", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const gate = sm.createHiddenGate();

            m.setVisibility("hidden");
            expect(gate.wasHiddenSinceLastCheck()).toBe(true);
            m.setVisibility("visible");
            expect(gate.wasHiddenSinceLastCheck()).toBe(true); // window began hidden
            expect(gate.wasHiddenSinceLastCheck()).toBe(false);
        });

        it("flags the first window of a gate created while hidden", () => {
            const m = createMocks("hidden", false);
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const gate = sm.createHiddenGate();

            m.setVisibility("visible");

            expect(gate.wasHiddenSinceLastCheck()).toBe(true);
        });

        it("holds no marks, so transitions never pile up behind an unchecked gate", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            sm.createHiddenGate();

            for (let i = 0; i < 1000; i++) {
                m.setFocus(false);
                m.setFocus(true);
            }

            expect(sm.getMarkCount()).toBe(0);
            expect(sm.getBufferedCount()).toBe(0);
        });

        it("dispose() stops tracking", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const gate = sm.createHiddenGate();

            gate.dispose();
            m.setVisibility("hidden");
            m.setVisibility("visible");

            expect(gate.wasHiddenSinceLastCheck()).toBe(false);
        });
    });
});
