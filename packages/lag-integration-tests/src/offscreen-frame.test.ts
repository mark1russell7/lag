import { expect } from "vitest";
import { createNoopMeter, setupAllMonitors, type AllMonitorHandles, type BrowserGlobals } from "@mark1russell7/lag";
import { createBrowserDeps, createTeeMeter, wait, waitUntil } from "./harness.js";
import { environment } from "./commands.js";
import { MIN_IDLE_MESSAGES, idleProbe } from "./idle-probe.js";

/** The time that the frame stays off the screen. It is longer than one cycle of MacrotaskLag (5 s). */
const OFFSCREEN_MS = 6_000;

/** The time that the browser can use to tell the frame that it is off the screen. In experiment E9, it was 20 ms or less. */
const NOTICE_MS = 500;

/**
 * The engines of WebKit. In a frame that is fully off the screen, WebKit
 * aligns the nested timers to 1 s (`LocalFrameView.cpp`, `Document.cpp`).
 */
const WEBKIT = new Set(["webkit", "safari", "ios"]);

/**
 * The timer monitors. DriftLag reads the 1 s of WebKit as lag, thus it
 * pauses. MacrotaskLag starts its timeout in a message task, where the
 * timeout is not nested, thus it measures correctly and it does not pause.
 */
const TIMER_METRICS = ["lag_drift_histogram", "lag_macrotask_histogram"] as const;

/** A frame of the same origin, above a spacer. A scroll of the test page moves the frame off the screen. */
async function createFrame() : Promise<{ frame : HTMLIFrameElement; child : Window & typeof globalThis; spacer : HTMLDivElement }> {
    const frame = document.createElement("iframe");
    frame.style.cssText = "display: block; width: 300px; height: 300px; border: 0";
    const loaded = new Promise<void>(resolve => frame.addEventListener("load", () => resolve(), { once : true }));
    frame.srcdoc = "<!doctype html><p>A frame of the lag test</p>";
    const spacer = document.createElement("div");
    spacer.style.height = "4000px";
    document.body.append(frame, spacer);
    await loaded;
    return { frame, child : frame.contentWindow as Window & typeof globalThis, spacer };
}

/** A chain of timeouts of 100 ms in the frame, as in experiment E9. It gives the longest step since the last reset. */
function watchFrameTimers(child : Window & typeof globalThis) {
    let last = performance.now();
    let longest = 0;
    let stopped = false;
    let handle = 0;
    const step = () : void => {
        const now = performance.now();
        longest = Math.max(longest, now - last);
        last = now;
        if (!stopped) handle = child.setTimeout(step, 100);
    };
    handle = child.setTimeout(step, 100);
    return {
        reset() { longest = 0; },
        longest : () => longest,
        stop() {
            stopped = true;
            child.clearTimeout(handle);
        },
    };
}

/** The monitors on the globals of a frame, with or without the frame viewport. */
type FrameRun = {
    longestOffscreen : number;
    /** The values of each timer metric off the screen, after the browser could tell the frame. */
    during : Record<string, number[]>;
    resumed : boolean;
    logs : string[];
    /** The longest frame gap that the frame-timing monitor recorded after the frame moved off the screen. */
    longestFrameGap : number;
};

/**
 * The monitors in a frame that is off the screen. The `visibilityState` of
 * such a frame stays `visible`, but WebKit makes its nested timers wait
 * approximately 1 s. Without a pause, DriftLag records that wait as lag: 2473
 * ms in one window of the WebKit build, before the change. Thus DriftLag
 * pauses while the frame is off the screen, as the frame-timing monitor does.
 * Without the frame viewport, DriftLag finds the throttled timers itself.
 */
describe("A frame off the screen", () => {
    let handles : AllMonitorHandles | undefined;
    let cleanup = () : void => {};

    afterEach(() => {
        handles?.stop();
        handles = undefined;
        cleanup();
    });

    async function runOffscreen(withViewport : boolean) : Promise<FrameRun> {
        const { frame, child, spacer } = await createFrame();
        const timers = watchFrameTimers(child);
        cleanup = () => {
            timers.stop();
            window.scrollTo(0, 0);
            frame.remove();
            spacer.remove();
        };
        const tee = createTeeMeter(createNoopMeter());
        const logs : string[] = [];
        const { frameViewport, ...deps } = createBrowserDeps({
            logger : { log : (level, message, args) => {
                logs.push(message);
                if (level === "error") console.log(`[error] ${message}`, args);
            } },
            meter : tee.meter,
            peerHangWatch : false,
            hangJournal : false,
            crashReportContext : false,
        }, child as unknown as BrowserGlobals);
        expect(frameViewport).toBeDefined();
        handles = setupAllMonitors(withViewport ? { ...deps, frameViewport : frameViewport! } : deps);

        // On the screen, the monitors operate. The chain of timeouts reaches its maximum nesting level after 10 steps.
        expect(await waitUntil(() => tee.values("lag_drift_histogram").length >= 5, 5_000)).toBe(true);
        await wait(1_500);

        timers.reset();
        window.scrollTo(0, 2_000);
        const offAt = performance.now();
        await wait(OFFSCREEN_MS);
        const longestOffscreen = timers.longest();
        window.scrollTo(0, 0);
        const onAt = performance.now();
        const resumed = await waitUntil(() => tee.records("lag_drift_histogram").some(record => record.time > onAt), 5_000);

        const during = Object.fromEntries(TIMER_METRICS.map(name => [
            name,
            tee.records(name).filter(record => record.time > offAt + NOTICE_MS && record.time < onAt).map(record => Math.round(record.value)),
        ]));
        // A frame gap of 5 s or more waits 2 s for late evidence before the monitor records it
        await wait(3_000);
        const longestFrameGap = Math.max(0, ...tee.records("lag_frame_delta_histogram").filter(record => record.time > offAt).map(record => record.value));
        console.log(`${environment()}${withViewport ? "" : ", without the frame viewport"}: longest step of a 100 ms timeout chain ` +
            `in the frame off the screen ${Math.round(longestOffscreen)} ms; records off the screen ${JSON.stringify(during)}; ` +
            `longest frame gap after ${Math.round(longestFrameGap)} ms`);
        return { longestOffscreen, during, resumed, logs, longestFrameGap };
    }

    it("pauses DriftLag while the frame is off the screen, and starts it again after", async () => {
        const run = await runOffscreen(true);

        // The case is real: WebKit makes the timers of the frame wait approximately 1 s
        if (WEBKIT.has(environment())) expect(run.longestOffscreen).toBeGreaterThan(800);
        expect(run.during["lag_drift_histogram"]).toEqual([]);
        expect(run.resumed).toBe(true);
        // Frame timing also paused: the time off the screen is not a frame gap
        expect(run.longestFrameGap).toBeLessThan(1_000);
    }, 30_000);

    it("without the frame viewport, DriftLag finds the throttled timers of WebKit and records no window of them", async (ctx) => {
        if (WEBKIT.has(environment())) {
            const idle = await idleProbe();
            ctx.skip(idle.messages < MIN_IDLE_MESSAGES, `A message waits on an idle page in this browser (${idle.messages} messages in 100 ms). ` +
                "Thus the probe of DriftLag cannot see an idle thread, and it cannot find throttled timers.");
        }
        const run = await runOffscreen(false);

        if (WEBKIT.has(environment())) {
            expect(run.longestOffscreen).toBeGreaterThan(800);
            expect(run.logs).toContain("DriftLag: the browser throttles the timers. The windows pause.");
            expect(run.logs).toContain("DriftLag: the timers are not throttled. The windows continue.");
            expect(run.during["lag_drift_histogram"]).toEqual([]);
            // Frame timing paused with the signal of DriftLag: WebKit renders no frame off the screen
            expect(run.longestFrameGap).toBeLessThan(1_000);
        } else {
            // Chromium and Firefox do not throttle these timers: DriftLag measures, and finds no lag
            expect(run.logs).not.toContain("DriftLag: the browser throttles the timers. The windows pause.");
            expect(run.during["lag_drift_histogram"]!.length).toBeGreaterThan(10);
            expect(Math.max(...run.during["lag_drift_histogram"]!)).toBeLessThan(100);
        }
        expect(run.resumed).toBe(true);
    }, 30_000);
});
