import { expect } from "vitest";
import { LifecycleStateMachine, isVisibleState, type StateTransition } from "@mark1russell7/lag";
import { cdp, recordMeasurement } from "../commands.js";
import { createRecordingLogger, wait, waitUntil } from "../harness.js";
import { PAUSED_METRICS, hiddenInterval, startMonitors } from "./monitors.js";

const describeTransition = (t : StateTransition) : string => `${t.from}->${t.to}:${t.trigger}`;

/**
 * Real page freezing: `Page.setWebLifecycleState` hides the page, freezes
 * it (no task runs), then resumes it. The page sees `visibilitychange`
 * (hidden), `freeze`, `resume` and `visibilitychange` (visible).
 */
describe("A frozen page (CDP Page.setWebLifecycleState)", () => {
    afterEach(async () => {
        await cdp.resetPage();
    });

    it("the lifecycle state machine sees the freeze and the resume", async () => {
        const transitions : StateTransition[] = [];
        const lifecycle = new LifecycleStateMachine(document, window, performance, createRecordingLogger());
        lifecycle.subscribe(transition => transitions.push(transition));
        try {
            const visible = lifecycle.getState();
            let ticks = 0;
            const ticker = setInterval(() => ticks++, 10);
            const { frozenMs } = await cdp.freezePage(1_000);
            const ticksAtResume = ticks;
            clearInterval(ticker);
            await waitUntil(() => isVisibleState(lifecycle.getState()));

            console.log(`Transitions: ${transitions.map(describeTransition).join(", ")}; frozen ${frozenMs} ms; ticks ${ticksAtResume}`);
            expect(transitions.map(describeTransition)).toEqual([
                `${visible}->hidden:visibilitychange`,
                "hidden->frozen:freeze",
                "frozen->hidden:resume",
                `hidden->${visible}:visibilitychange`,
            ]);
            // The transitions use the event times. The monotonic clock runs while the page is frozen.
            const frozenAt = transitions[1]!.timestamp;
            const resumedAt = transitions[2]!.timestamp;
            expect(resumedAt - frozenAt).toBeGreaterThan(frozenMs - 250);
            expect(resumedAt - frozenAt).toBeLessThan(frozenMs + 250);
            // The page did not run while it was frozen: a 10 ms interval ran at most a few times
            expect(ticksAtResume).toBeLessThan(30);
        } finally {
            lifecycle.dispose();
        }
    });

    it("timer monitors pause before the freeze, record no stall for it, and continue after the resume", async () => {
        const page = startMonitors();
        try {
            await wait(1_500);
            const { frozenMs } = await cdp.freezePage(2_000);
            await waitUntil(() => isVisibleState(page.handles.lifecycleStateMachine!.getState()));
            await wait(1_500);

            const { hiddenAt, visibleAt } = hiddenInterval(page.transitions);
            const discarded = page.tee.records("lag_samples_discarded").map(r => r.attributes?.["reason"]);
            const driftAfter = page.after("lag_drift_histogram", visibleAt).map(r => r.value);
            const workerAfter = page.after("lag_worker_main_block_histogram", visibleAt).map(r => r.value);
            console.log(`Frozen ${frozenMs} ms; hidden for ${(visibleAt - hiddenAt).toFixed(0)} ms; discarded: ${JSON.stringify(discarded)}; ` +
                `after the resume: ${driftAfter.length} drift samples (max ${Math.max(...driftAfter).toFixed(1)} ms), ` +
                `${workerAfter.length} heartbeats (max ${Math.max(...workerAfter).toFixed(1)} ms)`);
            await recordMeasurement("cdp/freeze/lag_drift_histogram", "ms", driftAfter, { scenario : "after-freeze" });
            await recordMeasurement("cdp/freeze/lag_worker_main_block_histogram", "ms", workerAfter, { scenario : "after-freeze" });

            expect(page.transitions.map(describeTransition)).toContain("hidden->frozen:freeze");
            expect(page.transitions.map(describeTransition)).toContain("frozen->hidden:resume");
            expect(visibleAt - hiddenAt).toBeGreaterThanOrEqual(frozenMs - 250);
            // 1. The monitors paused: no sample while the page was hidden or frozen
            for (const metric of PAUSED_METRICS) {
                expect(page.between(metric, hiddenAt, visibleAt), metric).toEqual([]);
            }
            // 2. The 2 s freeze is not lag. The worker measures the true blocking of the main thread.
            //    (DriftLag can show false lag here: see DriftLag.granularity.test.ts in @mark1russell7/lag.)
            expect(Math.max(...workerAfter)).toBeLessThan(200);
            expect(Math.max(...driftAfter)).toBeLessThan(frozenMs / 2);
            expect(page.tee.values("lag_stalls")).toEqual([]);
            // 3. A sample that overlapped the hidden or frozen interval was discarded, with that reason
            for (const reason of discarded) expect(["hidden", "frozen"]).toContain(reason);
            // 4. They continue after the resume
            expect(driftAfter.length).toBeGreaterThan(5);
            expect(workerAfter.length).toBeGreaterThan(3);
            // 5. The lifecycle counter has the freeze and the resume
            expect(page.tee.total("lag_lifecycle_transitions", { to : "frozen", trigger : "freeze" })).toBe(1);
            expect(page.tee.total("lag_lifecycle_transitions", { from : "frozen", trigger : "resume" })).toBe(1);
        } finally {
            page.stop();
        }
    });
});
