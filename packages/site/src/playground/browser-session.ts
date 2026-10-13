import { INP_THRESHOLDS, METRICS, TIMELINE_NAMES, startMonitors, type DemoFocus } from "../adapters/lag-core";
import { runLoadAction, runProfile } from "../adapters/lag-load";
import { demoFocusOf, demoMetricNames } from "./demos";
import { PlaygroundSession, type SessionKind, type SessionScheduler } from "./session";

export const browserScheduler : SessionScheduler = {
    now : () => performance.now(),
    timeOrigin : performance.timeOrigin,
    setInterval : (callback, ms) => window.setInterval(callback, ms),
    clearInterval : (handle) => window.clearInterval(handle as number),
};

/** A session with the monitor of one live demo of the documentation, and the loads of the playground. */
function createDemoSession(focus : DemoFocus) : PlaygroundSession {
    return new PlaygroundSession({
        runtime : {
            metrics : METRICS,
            start : (meter, onLog) => startMonitors({ meter, focus, onLog }),
        },
        loads : { run : runLoadAction, runProfile },
        scheduler : browserScheduler,
        windowMs : 30_000,
        watch : demoMetricNames(focus),
    });
}

/** A session with the real monitors in this page. */
export function createBrowserSession(kind : SessionKind) : PlaygroundSession {
    const focus = demoFocusOf(kind);
    if (focus) return createDemoSession(focus);
    return new PlaygroundSession({
        runtime : {
            metrics : METRICS,
            timeline : { names : TIMELINE_NAMES, inpThresholds : INP_THRESHOLDS },
            start : (meter, onLog, recorder) => startMonitors({ meter, onLog, recorder }),
        },
        loads : { run : runLoadAction, runProfile },
        scheduler : browserScheduler,
        ...(kind === "full" ? { windowMs : 30_000 } : { windowMs : 10_000, snapshotIntervalMs : 250 }),
    });
}
