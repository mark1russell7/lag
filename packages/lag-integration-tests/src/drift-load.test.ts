import { expect, type TestContext } from "vitest";
import { BusyTimeProbe, DriftLag, createMessageTaskQueue } from "@lag/core";
import { blockMainThread, median, wait } from "./harness.js";
import { recordMeasurement } from "./commands.js";

/**
 * DriftLag during a sustained load of equal tasks (experiment E5). Before
 * the probe of message tasks, the lag of such a load decreased to less than
 * 15% within 4 s in each engine (8 October 2026, Windows 11). The steps of a
 * busy thread agreed with each other, thus the monitor accepted them as a
 * new timer granularity, or the median of the recent steps became a busy
 * step. With message tasks of 20 ms, WebKit reported approximately 0 lag
 * after 0.5 s.
 */

const LOAD_MS = 3_000;
/** The probe cannot confirm a baseline if it measures more busy time than this on an idle page. */
const MAX_IDLE_BUSY_MS = 10;

type Window = { at : number; lag : number; windowMs : number };

/**
 * The busy time that a probe measures on an idle page, in 100 ms: the least
 * of three measurements. In the WebKit build of Playwright for Windows, a
 * message waits for the next timer tick of the system (approximately 15 ms)
 * after an idle period. The other engines measured 0 ms to 3 ms, and up to
 * 21 ms one time, after a test that logged much text.
 */
async function idleProbeBusyMs() : Promise<number> {
    const queue = createMessageTaskQueue(MessageChannel);
    const probe = new BusyTimeProbe((callback) => queue.post(callback), performance);
    const results : number[] = [];
    for (let i = 0; i < 3; i++) {
        await wait(200);
        probe.start();
        await wait(100);
        results.push(probe.stop());
    }
    queue.close();
    return Math.min(...results);
}

/** This function starts equal tasks until `endAt`: each task starts the next with a message, or with `setTimeout(0)`. */
function startLoad(kind : "message" | "timer", taskMs : number, endAt : number) : void {
    if (kind === "message") {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
            blockMainThread(taskMs);
            if (performance.now() < endAt) channel.port2.postMessage(null);
            else channel.port1.close();
        };
        channel.port2.postMessage(null);
        return;
    }
    const next = () : void => {
        blockMainThread(taskMs);
        if (performance.now() < endAt) setTimeout(next, 0);
    };
    setTimeout(next, 0);
}

async function measureLoad(test : TestContext, kind : "message" | "timer", taskMs : number) : Promise<void> {
    const idleBusyMs = await idleProbeBusyMs();
    console.log(`Probe on an idle page: ${idleBusyMs.toFixed(1)} ms of busy time in 100 ms`);
    await recordMeasurement("drift-load/probe/idle_busy_time", "ms", [idleBusyMs]);
    test.skip(idleBusyMs > MAX_IDLE_BUSY_MS, `A message waits on an idle page in this browser (${idleBusyMs.toFixed(1)} ms of 100 ms). ` +
        "Thus the probe cannot confirm a baseline, and DriftLag uses the recent steps, as without a probe.");

    const queue = createMessageTaskQueue(MessageChannel);
    const windows : Window[] = [];
    const monitor : DriftLag = new DriftLag(
        100,
        (lag) => windows.push({ at : performance.now(), lag, windowMs : monitor.getLastWindowMs() }),
        { log : () => {} },
        (fn, ms) => window.setInterval(fn, ms),
        (id) => window.clearInterval(id),
        (fn, ms) => window.setTimeout(fn, ms),
        (id) => window.clearTimeout(id),
        performance,
        { postTask : (callback) => queue.post(callback) },
    );
    try {
        await wait(1_500);
        const idleBaseline = monitor.getBaselineMs();
        const loadStart = performance.now();
        const loadEnd = loadStart + LOAD_MS;
        startLoad(kind, taskMs, loadEnd);
        await wait(LOAD_MS + 3_000);
        const loadBaseline = monitor.getBaselineMs();

        // The windows that end in the second half of the load, and the windows that start 1 s after it
        const late = windows.filter(w => w.at >= loadStart + LOAD_MS / 2 && w.at < loadEnd);
        const lagFraction = late.reduce((sum, w) => sum + w.lag, 0) / late.reduce((sum, w) => sum + w.windowMs, 0);
        const after = windows.filter(w => w.at - w.windowMs >= loadEnd + 1_000);
        const afterLag = median(after.map(w => w.lag));
        const afterWindowMs = median(after.map(w => w.windowMs));
        console.log(`${kind} tasks of ${taskMs} ms: lag ${(100 * lagFraction).toFixed(0)}% of the late windows, ` +
            `baseline ${idleBaseline.toFixed(1)} ms before and ${loadBaseline.toFixed(1)} ms after, ` +
            `median lag after ${afterLag.toFixed(1)} ms in windows of ${afterWindowMs.toFixed(0)} ms`);
        await recordMeasurement(`drift-load/${kind}-${taskMs}ms/lag_fraction`, "%", [100 * lagFraction], { scenario : `${kind}-${taskMs}ms` });

        expect(late.length).toBeGreaterThan(0);
        // Without the probe, this value was approximately 0 in each engine
        expect(lagFraction).toBeGreaterThan(0.1);
        // No lag after the load: a baseline that stays too low gave 19% to 34% of each window in
        // Chromium and Chrome. After a load, the steps of Firefox changed between 8 ms and 16 ms for
        // some seconds, thus the median lag of a window was between -9 ms and 8 ms.
        expect(after.length).toBeGreaterThan(10);
        expect(afterLag).toBeLessThan(0.1 * afterWindowMs);
    } finally {
        monitor.stop();
        queue.close();
    }
}

describe("DriftLag during a sustained load", () => {
    it("reports equal message tasks of 20 ms as lag, and no lag after the load", async (test) => {
        await measureLoad(test, "message", 20);
    }, 40_000);

    it("reports equal timer tasks of 30 ms as lag, and no lag after the load", async (test) => {
        await measureLoad(test, "timer", 30);
    }, 40_000);
});
