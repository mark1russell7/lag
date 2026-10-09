import { expect } from "vitest";
import { DriftLag } from "@mark1russell7/lag";
import { blockMainThread, median, wait } from "./harness.js";
import { recordMeasurement } from "./commands.js";

/**
 * DriftLag calibrates the timer granularity of the browser and the
 * operating system. Before the calibration, an idle page showed 16 ms of
 * lag for each window in Chromium and more than 200 ms in Firefox and WebKit
 * on Windows (their timers use the 15.6 ms tick of the system).
 */
describe("DriftLag accuracy", () => {
    it("reports approximately 0 on an idle page and the length of a block", async () => {
        const lags : number[] = [];
        const monitor = new DriftLag(
            100,
            (lag) => lags.push(lag),
            { log : () => {} },
            (fn, ms) => window.setInterval(fn, ms),
            (id) => window.clearInterval(id),
            (fn, ms) => window.setTimeout(fn, ms),
            (id) => window.clearTimeout(id),
            performance,
        );
        // The focus during the measured windows. A command of the test runner (recordMeasurement) can
        // give the window the focus later: in Safari, a read after the commands said true for a window
        // that had no focus during the windows.
        let lostFocus = !document.hasFocus();
        const onBlur = () : void => { lostFocus = true; };
        window.addEventListener("blur", onBlur);
        try {
            await wait(3_000);
            const idle = lags.splice(0);
            blockMainThread(300);
            await wait(1_000);
            const afterBlock = lags.splice(0);
            const baseline = monitor.getBaselineMs();
            const focused = !lostFocus && document.hasFocus();

            console.log(`DriftLag baseline ${baseline.toFixed(1)} ms, idle median ${median(idle).toFixed(1)} ms, block ${Math.max(...afterBlock).toFixed(1)} ms ` +
                `(visibilityState "${document.visibilityState}", focus during the windows ${focused})`);
            // The raw DriftLag value can be slightly negative (jitter around the baseline). The instrumented monitor clamps it at 0.
            await recordMeasurement("drift-accuracy/idle/drift_lag_raw", "ms", idle, { scenario : "idle" });
            await recordMeasurement("drift-accuracy/block-300ms/drift_lag_raw", "ms", [Math.max(...afterBlock)], { scenario : "block-300ms" });
            await recordMeasurement("drift-accuracy/baseline/drift_step_baseline", "ms", [baseline]);
            expect(idle.length).toBeGreaterThan(5);
            // macOS can delay the timers of an app that is not in front. Safari on a GitHub runner had no
            // focus, and its idle median was between 0 ms and 5.4 ms in 22 runs. A window has 100 ms.
            expect(Math.abs(median(idle))).toBeLessThan(focused ? 5 : 10);
            // The resolution is one step: up to the baseline less than the block. Without focus, some steps
            // of Safari are late, thus its baseline is longer than its usual step. Then each other step of the
            // window decreases the lag a little: the lag of the block was 12.4 ms less than 300 ms minus the
            // baseline one time.
            expect(Math.max(...afterBlock)).toBeGreaterThan(300 - baseline - (focused ? 10 : 20));
            expect(Math.max(...afterBlock)).toBeLessThan(340);
        } finally {
            window.removeEventListener("blur", onBlur);
            monitor.stop();
        }
    }, 30_000);
});
