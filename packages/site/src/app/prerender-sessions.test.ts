import { describe, expect, it, vi } from "vitest";
import { PlaygroundSession, type MonitorRuntime, type SessionScheduler } from "../playground/session";
import { sessionsWithoutStart } from "./prerender-sessions";

const METRICS = {
    driftLag : "drift",
    macrotaskLag : "macrotask",
    workerMainBlock : "worker",
    frameDelta : "frame",
    eventDuration : "event",
    gcEvents : "gc",
    lifecycleTransitions : "lifecycle",
} as const;

const scheduler : SessionScheduler = {
    now : () => 0,
    setInterval : () => 1,
    clearInterval : () => {},
};

describe("sessionsWithoutStart", () => {
    it("gives the sessions of the factory, but they do not start the monitors", async () => {
        const start = vi.fn<MonitorRuntime["start"]>();
        const created : PlaygroundSession[] = [];
        const factory = sessionsWithoutStart(async (kind) => {
            expect(kind).toBe("full");
            const session = new PlaygroundSession({ runtime : { metrics : METRICS, start }, scheduler });
            created.push(session);
            return session;
        });

        const session = await factory("full");
        expect(session).toBe(created[0]);
        session.start();
        expect(start).not.toHaveBeenCalled();
        expect(session.getSnapshot().status).toBe("idle");
        session.stop();
        expect(session.getSnapshot().status).toBe("idle");
    });

    it("gives the error of the factory", async () => {
        const factory = sessionsWithoutStart(() => Promise.reject(new Error("No worker.")));
        await expect(factory("timers")).rejects.toThrow("No worker.");
    });
});
