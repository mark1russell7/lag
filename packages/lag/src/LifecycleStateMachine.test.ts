import { vi, expect } from "vitest";
import {
    LifecycleStateMachine,
    summarizeTransitions,
    type LifecycleDocument,
    type LifecycleState,
    type LifecycleTrigger,
    type LifecycleWindow,
    type StateTransition,
} from "./LifecycleStateMachine.js";
import { createFakeEventTarget } from "./vitals/test-fakes.js";

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

    /** This function changes `visibilityState`. It does not send the visibilitychange event, because the browser sends it later. */
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

    it("notifies a restore at pageshow also when the page is visible already, as in the event sequence of Chromium", () => {
        const m = createMocks();
        const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
        m.fireWin("pagehide", { persisted : true });
        m.setVisibility("hidden");
        m.fireDoc("freeze");

        const transitions : string[] = [];
        sm.subscribe((t) => transitions.push(`${t.from}>${t.to}:${t.trigger}`));
        // Chromium restores with resume, visibilitychange and pageshow
        m.fireDoc("resume");
        m.setVisibility("visible");
        m.fireWin("pageshow", { persisted : true });

        expect(transitions.at(-1)).toBe("active>active:pageshow");
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

        it("cancel() of a mark that is not open keeps the open marks and their transitions", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const resolved = sm.mark();
            sm.resolve(resolved);
            const open = sm.mark();
            m.setFocus(false);

            sm.cancel(resolved);

            expect(sm.getMarkCount()).toBe(1);
            expect(sm.resolve(open).map(t => t.to)).toEqual(["passive"]);
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
            expect(logger.log).toHaveBeenCalledWith("error", "Error in lifecycle subscriber.", { error : expect.any(Error), type : "LifecycleStateMachine" });
        });
    });

    describe("handle()", () => {
        it("handles an event before the listener of the machine, and the listener then ignores that event", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const seen : string[] = [];
            sm.subscribe(({ from, to }) => seen.push(`${from}>${to}`));
            const pagehide = { type : "pagehide", persisted : false };

            // As the before-flush hook of an exporter whose listener starts first
            sm.handle(pagehide);
            expect(sm.getState()).toBe("terminated");
            m.fireWin("pagehide", pagehide);

            expect(seen).toEqual(["active>terminated"]);
        });

        it("gives one restore transition when the same pageshow event comes two times", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            m.fireWin("pagehide", { persisted : true });
            const seen : string[] = [];
            sm.subscribe(({ to, trigger }) => seen.push(`${trigger}:${to}`));
            const pageshow = { type : "pageshow", persisted : true };

            sm.handle(pageshow);
            sm.handle(pageshow);
            m.fireWin("pageshow", pageshow);

            expect(seen).toEqual(["pageshow:active"]);
        });

        it("handles a visibilitychange, and ignores other events, values that are not events, and all events after dispose()", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            m.setVisibilitySilently("hidden");
            sm.handle({ type : "click" });
            sm.handle(undefined);
            sm.handle("pagehide");
            sm.handle({ type : 7 });
            expect(sm.getTotalTransitions()).toBe(0);

            sm.handle({ type : "visibilitychange" });
            expect(sm.getTotalTransitions()).toBe(1);

            sm.dispose();
            sm.handle({ type : "pagehide", persisted : false });
            expect(sm.getTotalTransitions()).toBe(1);
        });
    });

    describe("listener phases and event times", () => {
        function setupTargets() {
            const document = Object.assign(createFakeEventTarget(), { visibilityState : "visible", hasFocus : () => true });
            const window = createFakeEventTarget();
            let now = 1_000;
            const sm = new LifecycleStateMachine(document, window, { now : () => now }, { log : vi.fn() });
            return { sm, document, window, setNow : (value : number) => { now = value; } };
        }

        it("listens in the capture phase, except for focus and blur", () => {
            const { document, window } = setupTargets();
            const phases = Object.fromEntries([...document.listeners(), ...window.listeners()].map(l => [l.type, l.capture]));

            expect(phases).toEqual({
                visibilitychange : true,
                freeze : true,
                resume : true,
                pagehide : true,
                pageshow : true,
                focus : false,
                blur : false,
            });
        });

        it("notifies its subscribers before a listener that was added earlier in the bubble phase", () => {
            const document = Object.assign(createFakeEventTarget(), { visibilityState : "visible", hasFocus : () => true });
            const window = createFakeEventTarget();
            const order : string[] = [];
            document.addEventListener("visibilitychange", () => order.push("exporter flush"));
            const sm = new LifecycleStateMachine(document, window, { now : () => 0 }, { log : vi.fn() });
            sm.subscribe(() => order.push("subscriber"));

            document.visibilityState = "hidden";
            document.dispatch("visibilitychange", {});

            expect(order).toEqual(["subscriber", "exporter flush"]);
        });

        it("uses the time of the event when it is applicable", () => {
            const { sm, document, window, setNow } = setupTargets();
            const transitions : number[] = [];
            sm.subscribe(t => transitions.push(t.timestamp));

            setNow(5_000);
            document.visibilityState = "hidden";
            document.dispatch("visibilitychange", { timeStamp : 4_990 });
            // A time after now (old browsers give Unix time) is not applicable
            window.dispatch("pagehide", { persisted : true, timeStamp : 1_700_000_000_000 });

            expect(transitions).toEqual([4_990, 5_000]);
        });

        it("dispose() removes the capture listeners with the same phase", () => {
            const { sm, document, window } = setupTargets();
            sm.dispose();
            expect([...document.listeners(), ...window.listeners()]).toEqual([]);
        });
    });

    describe("rules of the transitions", () => {
        /** The transitions that a subscriber gets, as "from>to:trigger". */
        function record(sm : LifecycleStateMachine) : string[] {
            const transitions : string[] = [];
            sm.subscribe(t => transitions.push(`${t.from}>${t.to}:${t.trigger}`));
            return transitions;
        }

        it("names the trigger of each transition", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const transitions = record(sm);

            m.setFocus(false);
            m.setFocus(true);
            m.setVisibility("hidden");
            m.fireDoc("freeze");
            m.fireDoc("resume");
            m.fireWin("pagehide", { persisted : false });

            expect(transitions).toEqual([
                "active>passive:blur",
                "passive>active:focus",
                "active>hidden:visibilitychange",
                "hidden>frozen:freeze",
                "frozen>hidden:resume",
                "hidden>terminated:pagehide",
            ]);
        });

        it("does not change the state at a focus or a blur while the page is hidden or frozen", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const transitions = record(sm);

            m.setVisibility("hidden");
            m.fireWin("focus");
            m.fireWin("blur");
            m.fireDoc("freeze");
            m.fireWin("focus");
            m.fireWin("blur");

            expect(sm.getState()).toBe("frozen");
            expect(transitions).toEqual(["active>hidden:visibilitychange", "hidden>frozen:freeze"]);
        });

        it("ignores a pageshow that is not a restore from the back/forward cache", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const transitions = record(sm);

            m.fireWin("pageshow", { persisted : false });

            expect(transitions).toEqual([]);
        });

        it("notifies a second freeze of a frozen page one time only", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            m.setVisibility("hidden");
            const transitions = record(sm);

            m.fireDoc("freeze");
            m.fireDoc("freeze");

            expect(transitions).toEqual(["hidden>frozen:freeze"]);
        });

        it("starts in the hidden state without a transition when the document is hidden", () => {
            const m = createMocks("hidden", true);
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const transitions = record(sm);

            expect(sm.getState()).toBe("hidden");
            expect(transitions).toEqual([]);
            expect(sm.getTotalTransitions()).toBe(0);
        });

        it("starts in the active state when the document has no hasFocus()", () => {
            const m = createMocks();
            const document : LifecycleDocument = {
                visibilityState : "visible",
                addEventListener : m.document.addEventListener,
                removeEventListener : m.document.removeEventListener,
            };
            const sm = new LifecycleStateMachine(document, m.window, m.clock, { log : vi.fn() });

            expect(sm.getState()).toBe("active");
        });

        it("stays terminated when the page is still visible after pagehide", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

            m.fireWin("pagehide", { persisted : false });

            expect(sm.getState()).toBe("terminated");
        });

        it("terminates at a pagehide event without data", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

            m.fireWin("pagehide");

            expect(sm.getState()).toBe("terminated");
        });

        it("uses the clock when the time of the event is not a positive number", () => {
            const document = Object.assign(createFakeEventTarget(), { visibilityState : "visible", hasFocus : () => true });
            const window = createFakeEventTarget();
            const sm = new LifecycleStateMachine(document, window, { now : () => 5_000 }, { log : vi.fn() });
            const times : unknown[] = [];
            sm.subscribe(t => times.push(t.timestamp));

            document.visibilityState = "hidden";
            document.dispatch("visibilitychange", { timeStamp : 0 });
            document.dispatch("freeze", { timeStamp : -5 });
            document.dispatch("resume", { timeStamp : "4000" });

            expect(times).toEqual([5_000, 5_000, 5_000]);
        });
    });

    describe("rules of the marks", () => {
        it("puts a mark after a visibility change that has no event yet", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

            m.setVisibilitySilently("hidden");
            const mark = sm.mark();

            expect(sm.resolve(mark)).toEqual([]);
        });

        it("includes a visibility change that has no event yet in resolve()", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });

            const mark = sm.mark();
            m.setVisibilitySilently("hidden");

            expect(sm.resolve(mark).map(t => t.to)).toEqual(["hidden"]);
        });

        it("gives an empty array for a resolved mark, also while another mark is open", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const first = sm.mark();
            sm.mark();
            m.setFocus(false);

            sm.resolve(first);

            expect(sm.resolve(first)).toEqual([]);
        });

        it("resolve() of a later mark gives only the transitions after it, while an earlier mark is open", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            sm.mark();
            m.setFocus(false);
            const later = sm.mark();
            m.setVisibility("hidden");

            expect(sm.resolve(later).map(t => t.to)).toEqual(["hidden"]);
        });

        it("keeps the transitions of the earliest open mark when a later mark is cancelled", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const first = sm.mark();
            m.setFocus(false);
            const second = sm.mark();
            m.setFocus(true);
            sm.mark();
            m.setVisibility("hidden");

            sm.cancel(second);

            expect(sm.resolve(first).map(t => t.to)).toEqual(["passive", "active", "hidden"]);
        });

        it("removes the transitions before the earliest open mark", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const first = sm.mark();
            m.setFocus(false);
            const second = sm.mark();
            m.setVisibility("hidden");

            sm.resolve(first);

            expect(sm.getBufferedCount()).toBe(1);
            expect(sm.resolve(second).map(t => t.to)).toEqual(["hidden"]);
        });

        it("dispose() removes the subscribers, the marks and the buffered transitions", () => {
            const m = createMocks();
            const sm = new LifecycleStateMachine(m.document, m.window, m.clock, { log : vi.fn() });
            const listener = vi.fn();
            sm.subscribe(listener);
            const mark = sm.mark();
            m.setFocus(false);
            listener.mockClear();

            sm.dispose();
            m.setVisibilitySilently("hidden");
            sm.getState();

            expect(listener).not.toHaveBeenCalled();
            expect(sm.getMarkCount()).toBe(0);
            expect(sm.getBufferedCount()).toBe(0);
            expect(sm.resolve(mark)).toEqual([]);
        });
    });

    describe("summarizeTransitions of a list", () => {
        const at = (from : LifecycleState, to : LifecycleState, trigger : LifecycleTrigger) : StateTransition => ({ from, to, trigger, timestamp : 0 });
        const none = {
            wasHidden : false,
            wasFrozen : false,
            wasTerminated : false,
            wasRestoredFromBFCache : false,
            wasFocused : false,
            wasBlurred : false,
            transitionCount : 0,
        };

        it("flags nothing for an empty list", () => {
            expect(summarizeTransitions([])).toEqual(none);
        });

        it("flags each kind of change in a list that has all of them", () => {
            const all = [
                at("active", "passive", "blur"),
                at("passive", "active", "focus"),
                at("active", "hidden", "visibilitychange"),
                at("hidden", "frozen", "freeze"),
                at("frozen", "active", "pageshow"),
                at("active", "terminated", "pagehide"),
            ];

            expect(summarizeTransitions(all)).toEqual({
                wasHidden : true,
                wasFrozen : true,
                wasTerminated : true,
                wasRestoredFromBFCache : true,
                wasFocused : true,
                wasBlurred : true,
                transitionCount : 6,
            });
        });

        it("flags only the change of a list with one transition", () => {
            expect(summarizeTransitions([at("active", "passive", "blur")])).toEqual({ ...none, wasBlurred : true, transitionCount : 1 });
            expect(summarizeTransitions([at("active", "hidden", "visibilitychange")])).toEqual({ ...none, wasHidden : true, transitionCount : 1 });
        });
    });
});
