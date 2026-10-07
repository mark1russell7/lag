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
            expect(onStall).toHaveBeenCalledWith("hang", 8_000);
        });

        it("discards an outlier when suspend evidence arrives during the wait", () => {
            const { conditions, onStall, onDiscard } = createConditions();
            const record = vi.fn();
            const now = Date.now();

            conditions.createValidator().submit(60_000, 60_100, record);
            // The worker reports that it did not run for 60 s, a moment after the sample
            vi.advanceTimersByTime(300);
            conditions.tracker.add(now - 60_000, now, "suspend");
            vi.advanceTimersByTime(2_000);

            expect(record).not.toHaveBeenCalled();
            expect(onStall).toHaveBeenCalledWith("suspend", 60_000);
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
    });
});
