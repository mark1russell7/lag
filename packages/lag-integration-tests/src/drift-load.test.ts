import { expect, type TestContext } from "vitest";
import { DriftLag, createMessageTaskQueue } from "@mark1russell7/lag";
import { blockMainThread, median, wait } from "./harness.js";
import { environment, recordMeasurement } from "./commands.js";
import { pageState } from "./animation-frames.js";
import { gapsBetween, watchTimers } from "./timer-watch.js";
import { MIN_IDLE_MESSAGES, idleProbe } from "./idle-probe.js";

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

/** The lag of the windows after the load, above the idle windows before it, as a part of a window. */
const AFTER_LOAD_MARGIN = 0.1;

/**
 * A gap of more than this value in a chain of 5 ms timers is a stall: the
 * browser started no timer of the page. Before and after the load, the page
 * does nothing, and the longest timer granularity is 40 ms (two ticks of the
 * Windows timer, with a margin). The windows that overlap a stall are not in
 * the check. A baseline that stays too low makes each step a little long,
 * and it makes no gap. Thus a stall cannot hide that error.
 */
const STALL_MS = 50;

type Window = { at : number; lag : number; windowMs : number };

/** The steps of the timer chain in a period: the mean step without the stalls, and the longest gap. */
function chainSteps(times : readonly number[], from : number, to : number) : { meanMs : number; maxGapMs : number } {
    const gaps = gapsBetween(times, from, to);
    const steps = gaps.filter(gap => gap <= STALL_MS);
    return { meanMs : steps.reduce((sum, step) => sum + step, 0) / steps.length, maxGapMs : Math.max(0, ...gaps) };
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
    // The timers of the browser itself, independent of the calibration of DriftLag
    const watch = watchTimers({ stallMs : STALL_MS });
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
        const timers = watch.stop();
        const end = performance.now();

        // The idle windows that start 0.5 s after the start of the monitor (after its first check), the windows
        // that end in the second half of the load, and the windows that start 1 s after the load. The check
        // after the load uses only the idle windows and the windows after the load that do not overlap a stall.
        const idleStart = monitorStart + 500;
        const afterStart = loadEnd + 1_000;
        const overlapsStall = (w : Window) : boolean => timers.stalls.some(stall => stall.start < w.at && stall.end > w.at - w.windowMs);
        const idleAll = windows.filter(w => w.at - w.windowMs >= idleStart && w.at < loadStart);
        const afterAll = windows.filter(w => w.at - w.windowMs >= afterStart);
        const idleWindows = idleAll.filter(w => !overlapsStall(w));
        const after = afterAll.filter(w => !overlapsStall(w));
        const idleLag = median(idleWindows.map(w => w.lag));
        const late = windows.filter(w => w.at >= loadStart + LOAD_MS / 2 && w.at < loadEnd);
        const lagFraction = late.reduce((sum, w) => sum + w.lag, 0) / late.reduce((sum, w) => sum + w.windowMs, 0);
        const afterLag = median(after.map(w => w.lag));
        const afterWindowMs = median(after.map(w => w.windowMs));
        const idleSteps = chainSteps(watch.times, idleStart, loadStart);
        const afterSteps = chainSteps(watch.times, afterStart, end);
        const stalled = idleAll.length - idleWindows.length + afterAll.length - after.length;
        const longestStallMs = Math.max(0, ...timers.stalls
            .filter(stall => [...idleAll, ...afterAll].some(w => stall.start < w.at && stall.end > w.at - w.windowMs))
            .map(stall => stall.end - stall.start));
        console.log(`${kind} tasks of ${taskMs} ms: lag ${(100 * lagFraction).toFixed(0)}% of the late windows, ` +
            `baseline ${idleBaseline.toFixed(1)} ms before and ${loadBaseline.toFixed(1)} ms after, ` +
            `median lag ${idleLag.toFixed(1)} ms before and ${afterLag.toFixed(1)} ms after, in windows of ${afterWindowMs.toFixed(0)} ms`);
        console.log(`Timer chain of 5 ms (${timers.count} callbacks): mean step ${idleSteps.meanMs.toFixed(2)} ms before the load and ` +
            `${afterSteps.meanMs.toFixed(2)} ms after it, longest gap ${idleSteps.maxGapMs.toFixed(0)} ms before and ${afterSteps.maxGapMs.toFixed(0)} ms after; ` +
            `${stalled} of ${idleAll.length + afterAll.length} windows overlap a gap of more than ${STALL_MS} ms`);
        await recordMeasurement(`drift-load/${kind}-${taskMs}ms/lag_fraction`, "%", [100 * lagFraction], { scenario : `${kind}-${taskMs}ms` });

        expect(late.length).toBeGreaterThan(0);
        // Without the probe, this value was approximately 0 in each engine
        expect(lagFraction).toBeGreaterThan(0.1);
        // A skip only when the stalls left too few windows: without a stall, too few windows is an error
        test.skip(stalled > 0 && (idleWindows.length <= 5 || after.length <= 10),
            `The browser stopped the timers of the page: ${stalled} windows overlap a gap of more than ${STALL_MS} ms in a chain of 5 ms timers ` +
            `(the longest is ${Math.round(longestStallMs)} ms). Only ${idleWindows.length} idle windows and ` +
            `${after.length} windows after the load remain (${pageState()}).`);
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
        const limit = Math.max(0, idleLag) + AFTER_LOAD_MARGIN * afterWindowMs;
        // The steps of Safari in the iOS Simulator are 8 ms or 12 ms: WebKit aligns nested timers to a grid
        // of 4 ms. In some CI runs, more steps took 12 ms for some seconds, also on an idle page: the baseline
        // was 9.0 ms to 9.6 ms, not 8.0 ms, and the idle median lag was up to 31 ms in a window of 113 ms
        // (45 runs, 9 to 12 October 2026). One run failed with a median lag of 17.4 ms after the load, in
        // windows of 114 ms, and 2.7 ms before it (baseline 9.2 ms before and 9.6 ms after). Its windows were
        // longer than 100 ms, but more than 10 windows came in 2 s: thus the timers were slower, and they did
        // not stop. That run had no timer chain, thus the cause is probable, not certain.
        //
        // The timer chain of the test does not use the calibration of DriftLag. A baseline that stays too low
        // does not change the steps of the chain. Thus the test skips itself only if the chain also had longer
        // steps after the load than before it, and these steps give the lag above the limit. Only in the iOS
        // Simulator: in the other engines, DriftLag must follow a change of the steps (the steps of Firefox
        // above), and the check stays strict.
        const slowerMs = afterWindowMs * Math.max(0, afterSteps.meanMs - idleSteps.meanMs) / afterSteps.meanMs;
        test.skip(environment() === "ios" && afterLag >= limit && afterLag < limit + slowerMs,
            `The browser made its timers slower after the load: the mean step of a chain of 5 ms timers was ${afterSteps.meanMs.toFixed(2)} ms ` +
            `after the load and ${idleSteps.meanMs.toFixed(2)} ms before it. That gives ${slowerMs.toFixed(1)} ms of a window of ${afterWindowMs.toFixed(0)} ms. ` +
            `DriftLag reported a median lag of ${afterLag.toFixed(1)} ms after the load, and the limit without the slower timers is ${limit.toFixed(1)} ms (${pageState()}).`);
        expect(afterLag).toBeLessThan(limit);
    } finally {
        watch.stop();
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
