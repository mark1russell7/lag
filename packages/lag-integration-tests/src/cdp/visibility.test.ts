import { expect } from "vitest";
import { isVisibleState } from "@mark1russell7/lag";
import { cdp, recordMeasurement } from "../commands.js";
import { wait, waitUntil } from "../harness.js";
import { PAUSED_METRICS, hiddenInterval, startMonitors } from "./monitors.js";

/**
 * A hidden page: a second page of the same browser context comes to the
 * front (Chromium in the new headless mode). Playwright launches Chromium
 * without background timer throttling, so a monitor that did not pause
 * would record samples while the page is hidden.
 */
describe("A hidden page (a second page in front)", () => {
    afterEach(async () => {
        await cdp.resetPage();
    });

    it("timer monitors pause while the page is hidden and continue when it is visible", async () => {
        const page = startMonitors();
        try {
            await wait(1_500);
            await cdp.hidePage();
            expect(await waitUntil(() => document.visibilityState === "hidden", 2_000)).toBe(true);
            // Timers still run while the page is hidden: the test counts them
            let ticks = 0;
            const ticker = setInterval(() => ticks++, 10);
            await wait(1_500);
            clearInterval(ticker);
            await cdp.showPage();
            expect(await waitUntil(() => document.visibilityState === "visible" && isVisibleState(page.handles.lifecycleStateMachine!.getState()), 2_000)).toBe(true);
            await wait(1_500);

            const { hiddenAt, visibleAt } = hiddenInterval(page.transitions);
            const workerAfter = page.after("lag_worker_main_block_histogram", visibleAt).map(r => r.value);
            console.log(`Hidden for ${(visibleAt - hiddenAt).toFixed(0)} ms, ${ticks} timer ticks while hidden; ` +
                `transitions: ${page.transitions.map(t => `${t.from}->${t.to}:${t.trigger}`).join(", ")}; ` +
                `discarded: ${JSON.stringify(page.tee.records("lag_samples_discarded").map(r => r.attributes?.["reason"]))}`);
            await recordMeasurement("cdp/after-hidden/lag_worker_main_block_histogram", "ms", workerAfter, { scenario : "after-hidden" });

            expect(page.transitions.map(t => `${t.to}:${t.trigger}`)).toEqual(["hidden:visibilitychange", expect.stringMatching(/^(active|passive):visibilitychange$/)]);
            expect(ticks).toBeGreaterThan(50);
            for (const metric of PAUSED_METRICS) {
                expect(page.between(metric, hiddenAt, visibleAt), metric).toEqual([]);
            }
            expect(page.after("lag_drift_histogram", visibleAt).length).toBeGreaterThan(5);
            expect(workerAfter.length).toBeGreaterThan(3);
            // The hidden period is not lag: the heartbeats after it are prompt
            expect(Math.max(...workerAfter)).toBeLessThan(200);
            for (const record of page.tee.records("lag_samples_discarded")) {
                expect(record.attributes?.["reason"]).toBe("hidden");
            }
        } finally {
            page.stop();
        }
    });
});
