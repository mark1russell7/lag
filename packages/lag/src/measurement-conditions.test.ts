import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMeasurementConditions, type MeasurementConditionsOptions } from "./measurement-conditions.js";
import { LifecycleStateMachine, type LifecycleDocument, type LifecycleWindow } from "./LifecycleStateMachine.js";

type Listener = (event : unknown) => void;

function createPage(initial : "visible" | "hidden" = "visible") {
    const listeners = new Map<string, Set<Listener>>();
    const target = {
        addEventListener(type : string, l : Listener) {
            if (!listeners.has(type)) listeners.set(type, new Set());
            listeners.get(type)!.add(l);
        },
        removeEventListener(type : string, l : Listener) { listeners.get(type)?.delete(l); },
    };
    const document : LifecycleDocument & { visibilityState : string } = {
        ...target,
        visibilityState : initial,
        hasFocus : () => true,
    };
    const window : LifecycleWindow = target;
    const fire = (type : string) => { for (const l of [...(listeners.get(type) ?? [])]) l(undefined); };
    return {
        document,
        window,
        hide() { document.visibilityState = "hidden"; fire("visibilitychange"); },
        show() { document.visibilityState = "visible"; fire("visibilitychange"); },
        /** Flip visibilityState without the (asynchronous) event. */
        hideSilently() { document.visibilityState = "hidden"; },
        /** The window loses the focus, or gets it again. */
        blur() { fire("blur"); },
        focus() { fire("focus"); },
        /** The browser freezes a hidden page, or resumes it. */
        freeze() { fire("freeze"); },
        resume() { fire("resume"); },
    };
}

function createConditions(options : Partial<MeasurementConditionsOptions> = {}, page = createPage()) {
    const clock = { now : () => Date.now() };
    const lifecycle = new LifecycleStateMachine(page.document, page.window, clock, { log : vi.fn() });
    const onStall = vi.fn();
    const onDiscard = vi.fn();
    const conditions = createMeasurementConditions({
        clock,
        setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
        clearTimeoutFn : (id) => clearTimeout(id),
        lifecycle,
        onStall,
        onDiscard,
        ...options,
    });
    return { conditions, lifecycle, page, onStall, onDiscard };
}

/** The kind and the value of each stall episode, without its start time. */
function kindsAndValues(onStall : ReturnType<typeof vi.fn>) : unknown[][] {
    return onStall.mock.calls.map(([kind, value]) => [kind, value]);
}

describe("createMeasurementConditions", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(10_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe("validator", () => {
        it("records a normal sample at once", () => {
            const { conditions } = createConditions();
            const record = vi.fn();

            conditions.createValidator().submit(12, 112, record);

            expect(record).toHaveBeenCalledWith(12);
        });

        it("discards a sample whose window overlaps a hidden period", () => {
            const { conditions, page, onDiscard } = createConditions();
            const record = vi.fn();

            vi.advanceTimersByTime(100);
            page.hide();
            vi.advanceTimersByTime(50);
            page.show();
            vi.advanceTimersByTime(50);
            conditions.createValidator().submit(5, 150, record);

            expect(record).not.toHaveBeenCalled();
            expect(onDiscard).toHaveBeenCalledWith("hidden");
        });

        it("keeps the first window after the page becomes visible again", () => {
            const { conditions, page } = createConditions();
            const record = vi.fn();

            page.hide();
            vi.advanceTimersByTime(5_000);
            page.show();
            vi.advanceTimersByTime(100);
            conditions.createValidator().submit(3, 100, record);

            expect(record).toHaveBeenCalledWith(3);
        });

        it("discards a sample when the page is hidden but visibilitychange has not fired yet", () => {
            const { conditions, page } = createConditions();
            const record = vi.fn();

            page.hideSilently();
            conditions.createValidator().submit(5, 100, record);

            expect(record).not.toHaveBeenCalled();
        });

        it("waits for late evidence before it records an outlier, then records it as a hang", () => {
            const { conditions, onStall } = createConditions();
            const record = vi.fn();

            conditions.createValidator().submit(8_000, 8_100, record);
            expect(record).not.toHaveBeenCalled();

            vi.advanceTimersByTime(2_000);
            expect(record).toHaveBeenCalledWith(8_000);
            // The episode waits for the stall samples of the other monitors
            expect(onStall).not.toHaveBeenCalled();
            vi.advanceTimersByTime(2_000);
            // The window of 8100 ms ended at 10 000
            expect(onStall).toHaveBeenCalledWith("hang", 8_000, 1_900);
        });

        it("reports the stall samples of one block as one episode, with the longest sample", () => {
            const { conditions, onStall } = createConditions();
            const record = vi.fn();
            // One 30 s block: a DriftLag window and three worker heartbeats that waited
            const drift = conditions.createValidator();
            const worker = conditions.createValidator();
            drift.submit(30_000, 30_100, record);
            worker.submit(29_000, 29_000, record);
            worker.submit(12_000, 12_000, record);
            vi.advanceTimersByTime(500);
            worker.submit(6_000, 6_500, record);
            vi.advanceTimersByTime(10_000);

            expect(record).toHaveBeenCalledTimes(4);
            // The episode starts at the start of its first window: the DriftLag window of 30 100 ms that ended at 10 000
            expect(onStall.mock.calls).toEqual([["hang", 30_000, -20_100]]);
        });

        it("reports separate blocks as separate episodes", () => {
            const { conditions, onStall } = createConditions();
            const validator = conditions.createValidator();
            validator.submit(6_000, 6_000, vi.fn());
            vi.advanceTimersByTime(20_000);
            validator.submit(7_000, 7_000, vi.fn());
            vi.advanceTimersByTime(20_000);

            expect(kindsAndValues(onStall)).toEqual([["hang", 6_000], ["hang", 7_000]]);
        });

        it("gives an episode the kind suspend when one of its samples gets suspend evidence during the wait", () => {
            const { conditions, onStall } = createConditions();
            const now = Date.now();
            const validator = conditions.createValidator();
            validator.submit(9_000, 9_000, vi.fn());
            // This window is only the last 3 s
            validator.submit(5_000, 3_000, vi.fn());
            // The evidence covers the first window, not the second one
            vi.advanceTimersByTime(300);
            conditions.tracker.add(now - 9_000, now - 4_000, "suspend");
            vi.advanceTimersByTime(10_000);

            expect(kindsAndValues(onStall)).toEqual([["suspend", 9_000]]);
        });

        it("discards a sample at once when the evidence exists before the sample, and counts a suspend stall", () => {
            const { conditions, onStall, onDiscard } = createConditions();
            const record = vi.fn();
            const now = Date.now();
            conditions.tracker.add(now - 9_000, now, "suspend");
            conditions.createValidator().submit(9_000, 9_000, record);
            vi.advanceTimersByTime(10_000);

            expect(record).not.toHaveBeenCalled();
            expect(onDiscard).toHaveBeenCalledWith("suspend");
            expect(kindsAndValues(onStall)).toEqual([["suspend", 9_000]]);
        });

        it("gives the same result when the sample comes before the suspend evidence or after it", () => {
            const order = (evidenceFirst : boolean) => {
                const { conditions, onStall } = createConditions();
                const now = Date.now();
                const validator = conditions.createValidator();
                // A Windows sleep of 60 s: DriftLag measures it, and a heartbeat with a self lag of 60 s is the evidence
                if (evidenceFirst) conditions.tracker.add(now - 60_050, now - 10, "suspend");
                validator.submit(60_000, 60_100, vi.fn());
                if (!evidenceFirst) conditions.tracker.add(now - 60_050, now + 20, "suspend");
                vi.advanceTimersByTime(10_000);
                conditions.dispose();
                return kindsAndValues(onStall);
            };
            expect(order(true)).toEqual([["suspend", 60_000]]);
            expect(order(false)).toEqual([["suspend", 60_000]]);
        });

        it("uses the suspend evidence when a window overlaps a hidden interval and a suspend", () => {
            const { conditions, onStall, onDiscard } = createConditions();
            const now = Date.now();
            conditions.tracker.add(now - 9_000, now - 8_000, "hidden");
            conditions.tracker.add(now - 7_000, now - 1_000, "suspend");
            conditions.createValidator().submit(9_000, 9_000, vi.fn());
            vi.advanceTimersByTime(10_000);

            expect(onDiscard).toHaveBeenCalledWith("suspend");
            expect(kindsAndValues(onStall)).toEqual([["suspend", 9_000]]);
        });

        it("counts no stall for a long sample in a hidden interval", () => {
            const { conditions, onStall, onDiscard } = createConditions();
            const now = Date.now();
            conditions.tracker.add(now - 9_000, now, "hidden");
            conditions.createValidator().submit(9_000, 9_000, vi.fn());
            vi.advanceTimersByTime(10_000);

            expect(onDiscard).toHaveBeenCalledWith("hidden");
            expect(onStall).not.toHaveBeenCalled();
        });

        it("dispose() reports the episodes that wait", () => {
            const { conditions, onStall } = createConditions();
            conditions.createValidator().submit(8_000, 8_000, vi.fn());
            vi.advanceTimersByTime(2_000);
            expect(onStall).not.toHaveBeenCalled();

            conditions.dispose();
            expect(onStall).toHaveBeenCalledWith("hang", 8_000, expect.any(Number));
            expect(vi.getTimerCount()).toBe(0);
        });

        it("discards an outlier when suspend evidence arrives during the wait", () => {
            const { conditions, onStall, onDiscard } = createConditions();
            const record = vi.fn();
            const now = Date.now();

            conditions.createValidator().submit(60_000, 60_100, record);
            // The worker reports that it did not run for 60 s, a moment after the sample
            vi.advanceTimersByTime(300);
            conditions.tracker.add(now - 60_000, now, "suspend");
            vi.advanceTimersByTime(4_000);

            expect(record).not.toHaveBeenCalled();
            expect(onStall).toHaveBeenCalledWith("suspend", 60_000, expect.any(Number));
            expect(onDiscard).toHaveBeenCalledWith("suspend");
        });

        it("uses the configured outlier threshold and wait", () => {
            const { conditions } = createConditions({ outlierThresholdMs : 100, confirmDelayMs : 10 });
            const record = vi.fn();

            conditions.createValidator().submit(150, 150, record);
            vi.advanceTimersByTime(9);
            expect(record).not.toHaveBeenCalled();
            vi.advanceTimersByTime(1);
            expect(record).toHaveBeenCalledWith(150);
        });

        it("dispose() cancels outliers that wait", () => {
            const { conditions } = createConditions();
            const record = vi.fn();
            const validator = conditions.createValidator();

            validator.submit(9_000, 9_000, record);
            validator.dispose();
            vi.advanceTimersByTime(10_000);

            expect(record).not.toHaveBeenCalled();
            expect(vi.getTimerCount()).toBe(0);
        });

        it("waits for late evidence before it records a sample at the outlier threshold", () => {
            const { conditions } = createConditions();
            const record = vi.fn();

            conditions.createValidator().submit(5_000, 5_000, record);
            expect(record).not.toHaveBeenCalled();
            vi.advanceTimersByTime(2_000);

            expect(record).toHaveBeenCalledWith(5_000);
        });

        it("counts a suspend stall for a discarded sample at the outlier threshold", () => {
            const { conditions, onStall } = createConditions();
            const now = Date.now();
            conditions.tracker.add(now - 5_000, now, "suspend");

            conditions.createValidator().submit(5_000, 5_000, vi.fn());
            vi.advanceTimersByTime(3_000);

            expect(kindsAndValues(onStall)).toEqual([["suspend", 5_000]]);
        });

        it("reports a stall sample that does not overlap the waiting episode as a separate episode", () => {
            const { conditions, onStall } = createConditions();
            const validator = conditions.createValidator();

            validator.submit(6_000, 6_000, vi.fn());
            vi.advanceTimersByTime(1_000);
            // This window starts 500 ms after the end of the first window
            validator.submit(7_000, 500, vi.fn());
            vi.advanceTimersByTime(10_000);

            expect(kindsAndValues(onStall)).toEqual([["hang", 6_000], ["hang", 7_000]]);
        });

        it("adds a stall sample whose window starts at the end of the waiting episode to the episode", () => {
            const { conditions, onStall } = createConditions();
            const validator = conditions.createValidator();

            validator.submit(6_000, 6_000, vi.fn());
            vi.advanceTimersByTime(1_000);
            validator.submit(7_000, 1_000, vi.fn());
            vi.advanceTimersByTime(10_000);

            expect(kindsAndValues(onStall)).toEqual([["hang", 7_000]]);
        });

        it("extends an episode with each sample that it gets, so that a later sample can overlap the extension", () => {
            const { conditions, onStall } = createConditions();
            const validator = conditions.createValidator();

            validator.submit(6_000, 6_000, vi.fn());
            vi.advanceTimersByTime(500);
            // This window ends 500 ms after the first window
            validator.submit(6_000, 1_000, vi.fn());
            vi.advanceTimersByTime(500);
            // This window overlaps only the part that the second window added
            validator.submit(6_000, 600, vi.fn());
            vi.advanceTimersByTime(10_000);

            expect(kindsAndValues(onStall)).toEqual([["hang", 6_000]]);
        });

        it("gives a hang episode the kind suspend when a sample with suspend evidence joins it", () => {
            const { conditions, onStall } = createConditions();
            const validator = conditions.createValidator();
            const start = Date.now();

            validator.submit(6_000, 6_000, vi.fn());
            vi.advanceTimersByTime(2_500);
            // The evidence covers only the window of the second sample
            conditions.tracker.add(start + 1_000, start + 2_000, "suspend");
            validator.submit(6_000, 3_000, vi.fn());
            vi.advanceTimersByTime(10_000);

            expect(kindsAndValues(onStall)).toEqual([["suspend", 6_000]]);
        });

        it("works without stall and discard listeners", () => {
            const page = createPage();
            const clock = { now : () => Date.now() };
            const conditions = createMeasurementConditions({
                clock,
                setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
                clearTimeoutFn : (id) => clearTimeout(id),
                lifecycle : new LifecycleStateMachine(page.document, page.window, clock, { log : vi.fn() }),
            });
            const record = vi.fn();

            page.hide();
            conditions.createValidator().submit(5, 100, record);
            page.show();
            vi.advanceTimersByTime(100);
            conditions.createValidator().submit(8_000, 100, record);
            vi.advanceTimersByTime(5_000);

            expect(record.mock.calls).toEqual([[8_000]]);
        });

        it("works without a lifecycle", () => {
            const record = vi.fn();
            const conditions = createMeasurementConditions({
                clock : { now : () => Date.now() },
                setTimeoutFn : (fn, ms) => setTimeout(fn, ms) as unknown as number,
                clearTimeoutFn : (id) => clearTimeout(id),
            });

            conditions.createValidator().submit(1, 1, record);

            expect(record).toHaveBeenCalledWith(1);
            expect(conditions.pauseWhileHidden({ start : vi.fn(), stop : vi.fn() })).toBeTypeOf("function");
        });
    });

    describe("lifecycle intervals", () => {
        it("opens an interval at creation when the page is hidden", () => {
            const { conditions } = createConditions({}, createPage("hidden"));
            expect(conditions.tracker.isUnreliableNow()).toBe(true);
        });

        it("records frozen periods with their own reason", () => {
            const { conditions, page, lifecycle } = createConditions();
            page.hide();
            // freeze is a document event
            (lifecycle as unknown as { transition(to : string, trigger : string) : void }).transition("frozen", "freeze");

            expect(conditions.tracker.findOverlap(Date.now() - 1, Date.now())?.reason).toBe("frozen");
        });

        it("dispose() stops following the lifecycle and closes the open interval", () => {
            const { conditions, page } = createConditions();
            page.hide();
            conditions.dispose();
            expect(conditions.tracker.isUnreliableNow()).toBe(false);

            page.show();
            page.hide();
            expect(conditions.tracker.isUnreliableNow()).toBe(false);
        });
    });

    describe("pauseWhileHidden", () => {
        it("stops a monitor while hidden and starts it again when visible", () => {
            const { conditions, page } = createConditions();
            const monitor = { start : vi.fn(), stop : vi.fn() };

            const unpause = conditions.pauseWhileHidden(monitor);
            page.hide();
            page.show();
            unpause();
            page.hide();

            expect(monitor.stop).toHaveBeenCalledTimes(1);
            expect(monitor.start).toHaveBeenCalledTimes(1);
        });

        it("stops a monitor at once when the page is hidden at the start", () => {
            const { conditions } = createConditions({}, createPage("hidden"));
            const monitor = { start : vi.fn(), stop : vi.fn() };

            conditions.pauseWhileHidden(monitor);

            expect(monitor.stop).toHaveBeenCalledTimes(1);
        });

        it("does not stop or start a monitor when the page loses the focus or gets it again", () => {
            const { conditions, page, lifecycle } = createConditions();
            const monitor = { start : vi.fn(), stop : vi.fn() };

            conditions.pauseWhileHidden(monitor);
            page.blur();
            expect(lifecycle.getState()).toBe("passive");
            page.focus();

            expect(monitor.stop).not.toHaveBeenCalled();
            expect(monitor.start).not.toHaveBeenCalled();
        });

        it("does not start a monitor when a hidden page becomes frozen and resumes, but starts it when the page is visible", () => {
            const { conditions, page, lifecycle } = createConditions();
            const monitor = { start : vi.fn(), stop : vi.fn() };

            conditions.pauseWhileHidden(monitor);
            page.hide();
            page.freeze();
            expect(lifecycle.getState()).toBe("frozen");
            page.resume();
            expect(monitor.start).not.toHaveBeenCalled();
            page.show();

            expect(monitor.stop).toHaveBeenCalledTimes(1);
            expect(monitor.start).toHaveBeenCalledTimes(1);
        });
    });
});
