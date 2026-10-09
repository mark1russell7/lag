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
            ...(kind === "full" ? { timeline : { names : TIMELINE_NAMES, inpThresholds : INP_THRESHOLDS } } : {}),
            start : (meter, onLog, recorder) => startMonitors({
                meter,
                scope : kind === "full" ? "all" : "timers",
                onLog,
                ...(kind === "full" ? { recorder } : {}),
            }),
        },
        ...(kind === "full" ? { loads : { run : runLoadAction, runProfile } } : {}),
        scheduler : browserScheduler,
        windowMs : kind === "full" ? 30_000 : 10_000,
    });
}
