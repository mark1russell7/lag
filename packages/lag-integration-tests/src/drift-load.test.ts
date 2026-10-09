import { expect, type TestContext } from "vitest";
import { BusyTimeProbe, DriftLag, createMessageTaskQueue } from "@mark1russell7/lag";
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

/**
 * The probe can confirm a baseline only if one probe on an idle page posts
 * this number of messages in 100 ms, or more. In the WebKit build of
 * Playwright for Windows, each message waits for a timer of 0 ms of the
 * system. There, the most messages of three probes were 122 to 278 in 32
 * runs (9 October 2026, also with four engines in parallel). In Chromium
 * and Firefox, they were 9,681 to 34,180. In CI, the other WebKit builds
 * post fewer messages, but they confirm a baseline: WebKit for Linux 904 to
 * 920, Safari on macOS 615 to 877, Safari on iOS 580 to 609. The limit is
 * between the two groups. An earlier rule used the busy time of the probe.
 * In WebKit for Windows, that time changed from 0 ms to 87 ms with the load
 * of the computer. Then the test operated, and it failed.
 */
const MIN_IDLE_MESSAGES = 400;

/** The lag of the windows after the load, above the idle windows before it, as a part of a window. */
const AFTER_LOAD_MARGIN = 0.1;

type Window = { at : number; lag : number; windowMs : number };

/**
 * The probe on an idle page, three times for 100 ms: the most messages that
 * one probe posted, and the least busy time.
 */
async function idleProbe() : Promise<{ messages : number; busyMs : number }> {
    let posted = 0;
    const queue = createMessageTaskQueue(MessageChannel);
    const probe = new BusyTimeProbe((callback) => {
        posted++;
        queue.post(callback);
    }, performance);
    const messages : number[] = [];
    const busyMs : number[] = [];
    for (let i = 0; i < 3; i++) {
        await wait(200);
        posted = 0;
        probe.start();
        await wait(100);
        busyMs.push(probe.stop());
        messages.push(posted);
    }
    queue.close();
    return { messages : Math.max(...messages), busyMs : Math.min(...busyMs) };
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
    const idle = await idleProbe();
    console.log(`Probe on an idle page: ${idle.messages} messages and ${idle.busyMs.toFixed(1)} ms of busy time in 100 ms`);
    await recordMeasurement("drift-load/probe/idle_messages", "{message}", [idle.messages]);
    await recordMeasurement("drift-load/probe/idle_busy_time", "ms", [idle.busyMs]);
    test.skip(idle.messages < MIN_IDLE_MESSAGES, `A message waits on an idle page in this browser (${idle.messages} messages in 100 ms). ` +
        "Thus the probe cannot confirm a baseline, and DriftLag uses the recent steps, as without a probe.");

    const queue = createMessageTaskQueue(MessageChannel);
    const windows : Window[] = [];
    const monitorStart = performance.now();
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

        // The idle windows that start 0.5 s after the start of the monitor (after its first check), the windows
        // that end in the second half of the load, and the windows that start 1 s after the load
        const idleWindows = windows.filter(w => w.at - w.windowMs >= monitorStart + 500 && w.at < loadStart);
        const idleLag = median(idleWindows.map(w => w.lag));
        const late = windows.filter(w => w.at >= loadStart + LOAD_MS / 2 && w.at < loadEnd);
        const lagFraction = late.reduce((sum, w) => sum + w.lag, 0) / late.reduce((sum, w) => sum + w.windowMs, 0);
        const after = windows.filter(w => w.at - w.windowMs >= loadEnd + 1_000);
        const afterLag = median(after.map(w => w.lag));
        const afterWindowMs = median(after.map(w => w.windowMs));
        console.log(`${kind} tasks of ${taskMs} ms: lag ${(100 * lagFraction).toFixed(0)}% of the late windows, ` +
            `baseline ${idleBaseline.toFixed(1)} ms before and ${loadBaseline.toFixed(1)} ms after, ` +
            `median lag ${idleLag.toFixed(1)} ms before and ${afterLag.toFixed(1)} ms after, in windows of ${afterWindowMs.toFixed(0)} ms`);
        await recordMeasurement(`drift-load/${kind}-${taskMs}ms/lag_fraction`, "%", [100 * lagFraction], { scenario : `${kind}-${taskMs}ms` });

        expect(late.length).toBeGreaterThan(0);
        // Without the probe, this value was approximately 0 in each engine
        expect(lagFraction).toBeGreaterThan(0.1);
        // No lag after the load: a baseline that stays too low gave 19% to 34% of each window in
        // Chromium and Chrome. After a load, the steps of Firefox changed between 8 ms and 16 ms for
        // some seconds, thus the median lag of a window was between -9 ms and 8 ms.
        //
        // The limit is the median lag of the idle windows before the load, plus 10% of a window. The
        // idle windows contain the noise of the computer: with four engines in parallel, their median
        // was up to 11.5 ms. An earlier limit of 10% of a window failed then, for example with 12.1 ms
        // in a window of 114 ms in Firefox. A negative idle median comes from the calibration (a
        // baseline a little above most steps), not from the computer. Thus it does not decrease the
        // limit. In 48 measurements, the lag after the load was not more than 7.4% of a window above
        // that base (9 October 2026). The error above gave 19% or more, thus the margin finds it.
        expect(idleWindows.length).toBeGreaterThan(5);
        expect(after.length).toBeGreaterThan(10);
        expect(afterLag).toBeLessThan(Math.max(0, idleLag) + AFTER_LOAD_MARGIN * afterWindowMs);
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
