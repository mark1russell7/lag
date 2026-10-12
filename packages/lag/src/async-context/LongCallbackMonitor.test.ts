import { describe, expect, it, vi } from "vitest";
import {
    ANONYMOUS_CALLBACK,
    LONG_CALLBACK_THRESHOLD_MS,
    LongCallbackMonitor,
    type CallbackHookLike,
    type LongCallback,
    type LongCallbackOptions,
} from "./LongCallbackMonitor.js";

/**
 * A fake of the callback hooks of async-browser-context. `run` starts a
 * callback as the library does: `before` of each hook in the order of
 * registration, the body, then `after` in the opposite order, also after an
 * error. The hooks of a callback are the hooks at its start.
 */
function createHookHost() {
    let hooks : CallbackHookLike[] = [];
    let now = 1_000;
    const removed = vi.fn();
    const addCallbackHook = vi.fn((hook : CallbackHookLike) => {
        hooks = [...hooks, hook];
        return () => {
            removed();
            hooks = hooks.filter(other => other !== hook);
        };
    });
    const run = (callback : Function, source : string, durationMs : number, body : () => void = () => {}) : void => {
        const current = hooks;
        for (const hook of current) hook.before?.(callback, source);
        try {
            now += durationMs;
            body();
        } finally {
            for (const hook of [...current].reverse()) hook.after?.(callback, source);
        }
    };
    return {
        addCallbackHook,
        removed,
        run,
        clock : { now : () => now },
        advance : (ms : number) => { now += ms; },
        hookCount : () => hooks.length,
    };
}

function setup(options : LongCallbackOptions = {}) {
    const host = createHookHost();
    const reports : LongCallback[] = [];
    const logger = { log : vi.fn() };
    const monitor = new LongCallbackMonitor(host.addCallbackHook, (report) => reports.push(report), host.clock, logger, options);
    return { host, reports, logger, monitor };
}

function checkout() : void {}
function renderSummary() : void {}

describe("LongCallbackMonitor", () => {
    it("adds one hook at the construction, with before and after", () => {
        const t = setup();

        expect(t.host.addCallbackHook).toHaveBeenCalledTimes(1);
        const hook = t.host.addCallbackHook.mock.calls[0]![0];
        expect(typeof hook.before).toBe("function");
        expect(typeof hook.after).toBe("function");
        expect(t.monitor.running).toBe(true);
    });

    it("reports a callback of 50 ms or more with its name, source, source kind, duration and start", () => {
        const t = setup();

        t.host.run(checkout, "setTimeout", 49.5);
        t.host.run(renderSummary, "addEventListener:click", 50);
        t.host.run(checkout, "Promise.then", 120);

        expect(t.reports).toEqual([
            { name : "renderSummary", source : "addEventListener:click", sourceKind : "event", durationMs : 50, startTime : 1_049.5, operation : undefined },
            { name : "checkout", source : "Promise.then", sourceKind : "promise", durationMs : 120, startTime : 1_099.5, operation : undefined },
        ]);
        expect(LONG_CALLBACK_THRESHOLD_MS).toBe(50);
    });

    it("uses the threshold of the options", () => {
        const t = setup({ thresholdMs : 100 });

        t.host.run(checkout, "setTimeout", 99);
        t.host.run(checkout, "setTimeout", 100);

        expect(t.reports.map(report => report.durationMs)).toEqual([100]);
    });

    it("measures the time of the clock from before to after, not the time before the callback", () => {
        const t = setup();

        t.host.advance(500);
        t.host.run(checkout, "setTimeout", 10);

        expect(t.reports).toEqual([]);
    });

    it("names a step after an await with the name of the async function", () => {
        const t = setup();
        // The library gives the body of the async function, with the name of the async function
        const body = function* () {};
        Object.defineProperty(body, "name", { value : "checkout" });

        t.host.run(body, "await", 80);

        expect(t.reports[0]).toMatchObject({ name : "checkout", source : "await", sourceKind : "await" });
    });

    it("names a callback without a name (anonymous)", () => {
        const t = setup();
        const [anonymous] = [() => {}];
        const numberName = () => {};
        Object.defineProperty(numberName, "name", { value : 7 });

        t.host.run(anonymous!, "setTimeout", 60);
        t.host.run(numberName, "setTimeout", 60);
        t.host.run(function bound() {}.bind(null), "setTimeout", 60);

        expect(t.reports.map(report => report.name)).toEqual([ANONYMOUS_CALLBACK, ANONYMOUS_CALLBACK, "bound bound"]);
        expect(ANONYMOUS_CALLBACK).toBe("(anonymous)");
    });

    it("gives each nested callback its own start: the callback that it starts synchronously is in both durations", () => {
        const t = setup();
        const outer = function dispatchUpdate() {};
        const inner = function onUpdate() {};

        t.host.run(outer, "setTimeout", 5, () => {
            t.host.run(inner, "addEventListener:update", 70);
            t.host.advance(5);
        });

        // The library starts the after methods in the opposite order: the inner callback first
        expect(t.reports).toEqual([
            { name : "onUpdate", source : "addEventListener:update", sourceKind : "event", durationMs : 70, startTime : 1_005, operation : undefined },
            { name : "dispatchUpdate", source : "setTimeout", sourceKind : "timer", durationMs : 80, startTime : 1_000, operation : undefined },
        ]);
    });

    it("reports a long inner callback of a short outer callback, and keeps the stack correct after the nesting", () => {
        const t = setup();

        t.host.run(checkout, "setTimeout", 1, () => {
            t.host.run(renderSummary, "Promise.then", 60);
            t.host.run(renderSummary, "Promise.then", 1);
        });
        t.host.run(checkout, "setTimeout", 30);

        expect(t.reports.map(report => [report.name, report.durationMs])).toEqual([["renderSummary", 60], ["checkout", 62]]);
    });

    it("measures the callback also when it throws an error", () => {
        const t = setup();

        expect(() => t.host.run(checkout, "setTimeout", 90, () => {
            throw new Error("failed");
        })).toThrow("failed");

        expect(t.reports.map(report => report.durationMs)).toEqual([90]);
    });

    it("ignores an after without a before: the callback started before the hook", () => {
        const t = setup();
        const hook = t.host.addCallbackHook.mock.calls[0]![0];

        hook.after!(checkout, "setTimeout");
        t.host.run(checkout, "setTimeout", 60);

        expect(t.reports.map(report => report.durationMs)).toEqual([60]);
        expect(t.logger.log).not.toHaveBeenCalled();
    });
});

describe("LongCallbackMonitor operation", () => {
    it("reads the operation only for a long callback, after the callback", () => {
        let current = "start";
        const operation = vi.fn(() => current);
        const t = setup({ operation });

        t.host.run(checkout, "setTimeout", 10);
        expect(operation).not.toHaveBeenCalled();

        t.host.run(checkout, "setTimeout", 60, () => {
            current = "checkout";
        });

        expect(operation).toHaveBeenCalledTimes(1);
        expect(t.reports[0]!.operation).toBe("checkout");
    });

    it.each([
        ["no value", undefined],
        ["an empty string", ""],
        ["a value that is not a string", 42 as unknown as string],
    ])("gives no operation when the function gives %s", (_case, value) => {
        const t = setup({ operation : () => value });

        t.host.run(checkout, "setTimeout", 60);

        expect(t.reports[0]!.operation).toBeUndefined();
    });

    it("reports the callback without an operation when the function throws, and logs one warning", () => {
        const error = new Error("no context");
        const t = setup({ operation : () => { throw error; } });

        t.host.run(checkout, "setTimeout", 60);
        t.host.run(renderSummary, "setTimeout", 70);

        expect(t.reports.map(report => [report.name, report.operation])).toEqual([["checkout", undefined], ["renderSummary", undefined]]);
        expect(t.logger.log).toHaveBeenCalledTimes(1);
        expect(t.logger.log).toHaveBeenCalledWith("warn", "The operation function of the long callback monitor failed.", { error, monitor : "long-callbacks" });
    });
});

describe("LongCallbackMonitor errors and stop", () => {
    it("logs an error of the report, and continues with the next callbacks", () => {
        const host = createHookHost();
        const logger = { log : vi.fn() };
        const error = new Error("sink failed");
        const durations : number[] = [];
        const report = vi.fn((callback : LongCallback) => {
            if (durations.length === 0 && callback.durationMs === 60) {
                durations.push(-1);
                throw error;
            }
            durations.push(callback.durationMs);
        });
        new LongCallbackMonitor(host.addCallbackHook, report, host.clock, logger);

        expect(() => host.run(checkout, "setTimeout", 60)).not.toThrow();
        host.run(checkout, "setTimeout", 1, () => host.run(renderSummary, "Promise.then", 70));

        expect(logger.log).toHaveBeenCalledTimes(1);
        expect(logger.log).toHaveBeenCalledWith("error", "Error reporting a long callback.", { error, monitor : "long-callbacks" });
        expect(durations).toEqual([-1, 70, 71]);
    });

    it("removes the hook at stop(), one time", () => {
        const t = setup();

        t.monitor.stop();
        t.monitor.stop();

        expect(t.host.removed).toHaveBeenCalledTimes(1);
        expect(t.host.hookCount()).toBe(0);
        expect(t.monitor.running).toBe(false);
        t.host.run(checkout, "setTimeout", 60);
        expect(t.reports).toEqual([]);
    });

    it("ignores the after of a callback that started before stop(), and the hook calls after stop()", () => {
        const t = setup();
        const hook = t.host.addCallbackHook.mock.calls[0]![0];

        // The library calls the hooks of a callback that started before the removal
        t.host.run(checkout, "setTimeout", 60, () => t.monitor.stop());
        hook.before!(checkout, "setTimeout");
        t.host.advance(100);
        hook.after!(checkout, "setTimeout");

        expect(t.reports).toEqual([]);
    });

    it("forgets the starts of the open callbacks at stop()", () => {
        const t = setup();
        const hook = t.host.addCallbackHook.mock.calls[0]![0];

        hook.before!(checkout, "setTimeout");
        t.monitor.stop();
        t.host.advance(100);
        hook.after!(checkout, "setTimeout");

        expect(t.reports).toEqual([]);
    });
});
