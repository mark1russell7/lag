import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserSession } from "./browser-session";
import type { PlaygroundSession } from "./session";

// The session publishes a snapshot every 500 ms, and the machine can be busy
// with other tests, so the tests wait for a condition instead of a fixed time.
const patience = { timeout : 10_000, interval : 100 };

let session : PlaygroundSession | undefined;

afterEach(() => {
    session?.dispose();
    session = undefined;
});

describe("browser session", () => {
    it("records the real monitors and sees a blocked main thread", async () => {
        const running = createBrowserSession("full");
        session = running;
        running.start();

        await vi.waitFor(() => {
            const snapshot = running.getSnapshot();
            expect(snapshot.series.drift.count).toBeGreaterThan(5);
            expect(snapshot.series.workerBlock.count).toBeGreaterThan(3);
        }, patience);
        const before = running.getSnapshot();
        expect(before.status).toBe("running");
        expect(before.workerRunning).toBe(true);
        expect(before.lifecycleState).toBeDefined();

        await running.runLoad("block-200");
        expect(running.getSnapshot().history[0]).toMatchObject({ kind : "action", id : "block-200" });
        await vi.waitFor(() => {
            const snapshot = running.getSnapshot();
            expect(snapshot.series.drift.max ?? 0).toBeGreaterThan(150);
            expect(snapshot.series.workerBlock.max ?? 0).toBeGreaterThan(100);
        }, patience);
    });

    it("releases every gauge callback when it stops", async () => {
        const running = createBrowserSession("full");
        session = running;
        running.start();
        await vi.waitFor(() => {
            expect(running.liveMeter?.callbackCount()).toBeGreaterThan(0);
        }, patience);
        const meter = running.liveMeter;
        running.stop();
        expect(meter?.callbackCount()).toBe(0);
        expect(running.getSnapshot().status).toBe("stopped");
    });

    it("runs only the timer monitors for the home page", async () => {
        const running = createBrowserSession("timers");
        session = running;
        running.start();
        await vi.waitFor(() => {
            expect(running.getSnapshot().series.drift.count).toBeGreaterThan(2);
        }, patience);
        const snapshot = running.getSnapshot();
        expect(snapshot.workerRunning).toBe(false);
        expect(snapshot.series.frameDelta.count).toBe(0);
    });
});
