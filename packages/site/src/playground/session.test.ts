import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Meter } from "../adapters/lag-core";
import type { ProfileRun } from "../adapters/lag-load";
import { PlaygroundSession, type LoadRunner, type MonitorRuntime, type SessionScheduler } from "./session";

const METRICS = {
    driftLag : "drift",
    workerMainBlock : "worker",
    frameDelta : "frame",
    eventDuration : "event",
    gcEvents : "gc",
    lifecycleTransitions : "lifecycle",
} as const;

/** A runtime that records into the meter like the real monitors, and tracks its own teardown. */
function fakeRuntime() {
    const state = {
        stops : 0,
        terminates : 0,
        meter : undefined as Meter | undefined,
    };
    const runtime : MonitorRuntime = {
        metrics : METRICS,
        start(meter, onLog) {
            state.meter = meter;
            meter.createHistogram("fps", { unit : "{frame}/s" }).record(60);
            onLog({ level : "warn", message : "Compute pressure is not available." });
            return {
                handles : { stop : () => { state.stops++; } },
                worker : { terminate : () => { state.terminates++; } },
                lifecycleState : () => "active",
            };
        },
    };
    return { runtime, state };
}

const scheduler : SessionScheduler = {
    now : () => Date.now(),
    setInterval : (callback, ms) => setInterval(callback, ms),
    clearInterval : (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

describe("PlaygroundSession", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("starts idle", () => {
        const session = new PlaygroundSession({ runtime : fakeRuntime().runtime, scheduler });
        expect(session.getSnapshot().status).toBe("idle");
        expect(vi.getTimerCount()).toBe(0);
    });

    it("publishes snapshots two times each second while it runs", () => {
        const { runtime, state } = fakeRuntime();
        const session = new PlaygroundSession({ runtime, scheduler });
        const listener = vi.fn();
        session.subscribe(listener);
        session.start();
        expect(session.getSnapshot().status).toBe("running");
        expect(listener).toHaveBeenCalledTimes(1);

        const drift = state.meter!.createHistogram("drift", { unit : "ms" });
        vi.advanceTimersByTime(100);
        drift.record(4);
        vi.advanceTimersByTime(100);
        drift.record(200);
        state.meter!.createCounter("gc", { unit : "{gc}" }).add(1);
        state.meter!.createCounter("lifecycle", { unit : "{transition}" }).add(1, { from : "active", to : "passive", trigger : "blur" });
        vi.advanceTimersByTime(300);

        expect(listener).toHaveBeenCalledTimes(2);
        const snapshot = session.getSnapshot();
        expect(snapshot.series.drift.points).toEqual([{ t : 0.1, value : 4 }, { t : 0.2, value : 200 }]);
        expect(snapshot.series.drift).toMatchObject({ count : 2, latest : 200, max : 200, p95 : 200 });
        expect(snapshot.series.frameDelta.count).toBe(0);
        expect(snapshot.gcEvents).toBe(1);
        expect(snapshot.lifecycleTransitions).toBe(1);
        expect(snapshot.lastTransition).toEqual({ from : "active", to : "passive", trigger : "blur" });
        expect(snapshot.lifecycleState).toBe("active");
        expect(snapshot.workerRunning).toBe(true);
        expect(snapshot.log).toEqual([{ t : 0, level : "warn", message : "Compute pressure is not available." }]);
        expect(snapshot.elapsedSeconds).toBe(0.5);
        expect(session.liveMeter?.read("fps")?.count).toBe(1);
        session.dispose();
    });

    it("drops values that are older than the window", () => {
        const { runtime, state } = fakeRuntime();
        const session = new PlaygroundSession({ runtime, scheduler, windowMs : 1_000 });
        session.start();
        state.meter!.createHistogram("drift", { unit : "ms" }).record(1);
        vi.advanceTimersByTime(1_500);
        expect(session.getSnapshot().series.drift.count).toBe(0);
        session.dispose();
    });

    it("stops the handles, terminates the worker and leaves no timers", () => {
        const { runtime, state } = fakeRuntime();
        const session = new PlaygroundSession({ runtime, scheduler });
        session.start();
        expect(vi.getTimerCount()).toBe(1);
        session.stop();
        expect(state.stops).toBe(1);
        expect(state.terminates).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
        expect(session.getSnapshot().status).toBe("stopped");
        session.stop();
        expect(state.stops).toBe(1);
    });

    it("starts again with a new meter", () => {
        const { runtime, state } = fakeRuntime();
        const session = new PlaygroundSession({ runtime, scheduler });
        session.start();
        const first = session.liveMeter;
        state.meter!.createHistogram("drift", { unit : "ms" }).record(3);
        session.stop();
        session.start();
        expect(session.liveMeter).not.toBe(first);
        expect(session.getSnapshot().series.drift.count).toBe(0);
        session.dispose();
        expect(vi.getTimerCount()).toBe(0);
    });

    it("reports a runtime that fails to start", () => {
        const runtime : MonitorRuntime = { metrics : METRICS, start : () => { throw new Error("No timers."); } };
        const session = new PlaygroundSession({ runtime, scheduler });
        session.start();
        expect(session.getSnapshot()).toMatchObject({ status : "failed", error : "No timers." });
        expect(vi.getTimerCount()).toBe(0);
    });

    it("runs one load at a time and keeps a history", async () => {
        let finish = () => {};
        const loads : LoadRunner = {
            run : vi.fn(() => new Promise<void>((resolve) => { finish = resolve; })),
            runProfile : vi.fn(),
        };
        const session = new PlaygroundSession({ runtime : fakeRuntime().runtime, loads, scheduler });
        await session.runLoad("block-50");
        expect(loads.run).not.toHaveBeenCalled();

        session.start();
        const first = session.runLoad("block-200");
        expect(session.getSnapshot().activeLoad).toMatchObject({ kind : "action", id : "block-200" });
        await session.runLoad("block-800");
        expect(loads.run).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(200);
        finish();
        await first;
        const snapshot = session.getSnapshot();
        expect(snapshot.activeLoad).toBeUndefined();
        expect(snapshot.history).toEqual([{ kind : "action", id : "block-200", startedAt : 0, durationMs : 200, aborted : false }]);
        session.dispose();
    });

    it("stops a profile when the session stops", async () => {
        let signal : AbortSignal | undefined;
        const loads : LoadRunner = {
            run : vi.fn(),
            runProfile : (_id, _durationMs, abort) : Promise<ProfileRun> => {
                signal = abort;
                return new Promise((resolve) => {
                    abort.addEventListener("abort", () => resolve({ eventCount : 1, totalLagMs : 5, durationMs : 50, aborted : true }));
                });
            },
        };
        const session = new PlaygroundSession({ runtime : fakeRuntime().runtime, loads, scheduler });
        session.start();
        const run = session.runProfile("heavy", 10_000);
        expect(session.getSnapshot().activeLoad).toMatchObject({ kind : "profile", id : "heavy", durationMs : 10_000 });
        session.stop();
        expect(signal?.aborted).toBe(true);
        await expect(run).resolves.toMatchObject({ aborted : true });
        expect(session.getSnapshot().history[0]).toMatchObject({ kind : "profile", id : "heavy", aborted : true });
    });
});
