import { INP_THRESHOLDS, METRICS, TIMELINE_NAMES, startMonitors } from "../adapters/lag-core";
import { runLoadAction, runProfile } from "../adapters/lag-load";
import { PlaygroundSession, type SessionKind, type SessionScheduler } from "./session";

export const browserScheduler : SessionScheduler = {
    now : () => performance.now(),
    timeOrigin : performance.timeOrigin,
    setInterval : (callback, ms) => window.setInterval(callback, ms),
    clearInterval : (handle) => window.clearInterval(handle as number),
};

/** A session with the real monitors in this page. */
export function createBrowserSession(kind : SessionKind) : PlaygroundSession {
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
