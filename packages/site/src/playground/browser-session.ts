import { METRICS, startMonitors } from "../adapters/lag-core";
import { runLoadAction, runProfile } from "../adapters/lag-load";
import { PlaygroundSession, type SessionKind, type SessionScheduler } from "./session";

export const browserScheduler : SessionScheduler = {
    now : () => performance.now(),
    setInterval : (callback, ms) => window.setInterval(callback, ms),
    clearInterval : (handle) => window.clearInterval(handle as number),
};

/** A session with the real monitors in this page. */
export function createBrowserSession(kind : SessionKind) : PlaygroundSession {
    return new PlaygroundSession({
        runtime : {
            metrics : METRICS,
            start : (meter, onLog) => startMonitors({ meter, scope : kind === "full" ? "all" : "timers", onLog }),
        },
        ...(kind === "full" ? { loads : { run : runLoadAction, runProfile } } : {}),
        scheduler : browserScheduler,
        windowMs : kind === "full" ? 30_000 : 10_000,
    });
}
